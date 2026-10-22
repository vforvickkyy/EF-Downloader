package gdrive

import (
	"context"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"unicode"
)

// Node is one entry of a scanned tree, flattened in display order (each
// folder is followed by its contents).
type Node struct {
	Item
	Parent  int    // index of the parent folder in Result.Nodes, -1 at the top
	Depth   int    // 0 at the top
	RelPath string // path under the download folder, with Windows-safe names
	Export  *Export
	// NoDownload explains why a file can't be downloaded (Forms, ...).
	NoDownload string
}

// Result is a scanned set of links.
type Result struct {
	Nodes    []*Node
	Title    string // the folder or file name, or "N items" for several links
	UsingAPI bool
	Warnings []string
}

// ScanProgress reports how far a scan has got.
type ScanProgress struct {
	Folders int    `json:"folders"`
	Files   int    `json:"files"`
	Current string `json:"current"`
}

type treeNode struct {
	item     *Item
	children []*treeNode
}

// Scan resolves links and walks every folder below them.
func (c *Client) Scan(ctx context.Context, links []Link, docs DocsFormat, progress func(ScanProgress)) (*Result, error) {
	s := &scanner{c: c, ctx: ctx, progress: progress, useAPI: c.HasAPIKey()}
	res := &Result{}

	var roots []*treeNode
	for _, l := range links {
		root, err := s.resolve(l)
		if err != nil && s.useAPI && KindOf(err) == ErrBadKey {
			// A broken key should not block public downloads.
			res.Warnings = append(res.Warnings, err.Error()+" Continuing without the API key.")
			s.useAPI = false
			root, err = s.resolve(l)
		}
		if err != nil {
			if len(links) == 1 {
				return nil, err
			}
			res.Warnings = append(res.Warnings, fmt.Sprintf("%s: %v", l.Raw, err))
			continue
		}
		roots = append(roots, root)
	}
	if len(roots) == 0 {
		return nil, fmt.Errorf("none of the links could be opened")
	}

	if err := s.walk(roots); err != nil {
		return nil, err
	}
	res.UsingAPI = s.useAPI
	res.Warnings = append(res.Warnings, s.warnings...)

	// Flatten in display order with Windows-safe, unique names.
	var flatten func(n *treeNode, parent, depth int, dir string, dd *NameDeduper)
	flatten = func(n *treeNode, parent, depth int, dir string, dd *NameDeduper) {
		node := &Node{Item: *n.item, Parent: parent, Depth: depth}
		name := SanitizeName(n.item.Name)
		if node.IsGoogleNative() {
			if exp, ok := ExportFor(node.MimeType, docs); ok {
				node.Export = &exp
				name = WithExt(name, exp.Ext)
			} else {
				node.NoDownload = noDownloadReason(node.MimeType)
			}
		}
		name = dd.Unique(name, node.IsFolder())
		node.Name = name
		node.RelPath = filepath.Join(dir, name)
		idx := len(res.Nodes)
		res.Nodes = append(res.Nodes, node)
		if node.IsFolder() {
			sortChildren(n.children)
			var childDD NameDeduper
			for _, ch := range n.children {
				flatten(ch, idx, depth+1, node.RelPath, &childDD)
			}
		}
	}
	var topDD NameDeduper
	for _, r := range roots {
		flatten(r, -1, 0, "", &topDD)
	}

	if len(roots) == 1 {
		res.Title = res.Nodes[0].Name
	} else {
		res.Title = fmt.Sprintf("%d items", len(roots))
	}
	return res, nil
}

func noDownloadReason(mime string) string {
	switch mime {
	case MimeForm:
		return "Google Forms can't be downloaded"
	case MimeShortcut:
		return "Shortcut to an item that isn't shared"
	}
	kind := strings.TrimPrefix(mime, googleAppsPrefix)
	if kind == "" {
		kind = "file"
	}
	return "Google " + kind + " files can't be downloaded"
}

type scanner struct {
	c        *Client
	ctx      context.Context
	progress func(ScanProgress)
	useAPI   bool

	mu       sync.Mutex
	folders  int
	files    int
	warnings []string
}

func (s *scanner) resolve(l Link) (*treeNode, error) {
	var (
		it  *Item
		err error
	)
	if s.useAPI {
		it, err = s.c.apiGet(s.ctx, l.ID, l.ResourceKey)
	} else {
		it, err = s.c.webResolve(s.ctx, l)
	}
	if err != nil {
		return nil, err
	}
	if it.ResourceKey == "" {
		it.ResourceKey = l.ResourceKey
	}
	if !it.IsFolder() {
		s.mu.Lock()
		s.files++
		s.mu.Unlock()
	}
	return &treeNode{item: it}, nil
}

// walk lists every folder below roots, a few folders at a time.
func (s *scanner) walk(roots []*treeNode) error {
	parallel := 4
	if s.useAPI {
		parallel = 6
	}
	var (
		wg       sync.WaitGroup
		sem      = make(chan struct{}, parallel)
		firstErr error
		errOnce  sync.Once
	)
	var visit func(n *treeNode, top bool)
	visit = func(n *treeNode, top bool) {
		defer wg.Done()
		select {
		case sem <- struct{}{}:
		case <-s.ctx.Done():
			return
		}
		children, name, err := s.list(n.item)
		<-sem
		if err != nil {
			if s.ctx.Err() != nil {
				return
			}
			if top {
				errOnce.Do(func() { firstErr = err })
				return
			}
			s.mu.Lock()
			s.warnings = append(s.warnings, fmt.Sprintf("Couldn't open folder \"%s\": %v", n.item.Name, err))
			s.mu.Unlock()
			return
		}
		if n.item.Name == "" || n.item.Name == n.item.ID {
			n.item.Name = name
		}
		if n.item.Name == "" {
			n.item.Name = n.item.ID
		}
		s.mu.Lock()
		s.folders++
		for _, ch := range children {
			n.children = append(n.children, &treeNode{item: ch})
			if !ch.IsFolder() {
				s.files++
			}
		}
		p := ScanProgress{Folders: s.folders, Files: s.files, Current: n.item.Name}
		s.mu.Unlock()
		if s.progress != nil {
			s.progress(p)
		}
		for _, ch := range n.children {
			if ch.item.IsFolder() {
				wg.Add(1)
				go visit(ch, false)
			}
		}
	}
	for _, r := range roots {
		if r.item.IsFolder() {
			wg.Add(1)
			go visit(r, true)
		}
	}
	wg.Wait()
	if err := s.ctx.Err(); err != nil {
		return err
	}
	return firstErr
}

func (s *scanner) list(it *Item) ([]*Item, string, error) {
	if s.useAPI {
		items, err := s.c.apiList(s.ctx, it.ID, it.ResourceKey)
		return items, it.Name, err
	}
	name, items, err := s.c.webListFolder(s.ctx, it.ID, it.ResourceKey)
	return items, name, err
}

// sortChildren orders folders first, then files, each in natural order
// ("Lesson 2" before "Lesson 10"). The ID breaks ties so duplicate names get
// the same " (2)" suffix on every scan.
func sortChildren(ch []*treeNode) {
	sort.SliceStable(ch, func(i, j int) bool {
		a, b := ch[i].item, ch[j].item
		if a.IsFolder() != b.IsFolder() {
			return a.IsFolder()
		}
		if c := naturalCompare(a.Name, b.Name); c != 0 {
			return c < 0
		}
		return a.ID < b.ID
	})
}

// naturalCompare compares strings case-insensitively, treating runs of
// digits as numbers.
func naturalCompare(a, b string) int {
	ra, rb := []rune(strings.ToLower(a)), []rune(strings.ToLower(b))
	i, j := 0, 0
	for i < len(ra) && j < len(rb) {
		if unicode.IsDigit(ra[i]) && unicode.IsDigit(rb[j]) {
			si, sj := i, j
			for i < len(ra) && unicode.IsDigit(ra[i]) {
				i++
			}
			for j < len(rb) && unicode.IsDigit(rb[j]) {
				j++
			}
			na := strings.TrimLeft(string(ra[si:i]), "0")
			nb := strings.TrimLeft(string(rb[sj:j]), "0")
			if len(na) != len(nb) {
				if len(na) < len(nb) {
					return -1
				}
				return 1
			}
			if na != nb {
				if na < nb {
					return -1
				}
				return 1
			}
			continue
		}
		if ra[i] != rb[j] {
			if ra[i] < rb[j] {
				return -1
			}
			return 1
		}
		i++
		j++
	}
	switch {
	case len(ra)-i < len(rb)-j:
		return -1
	case len(ra)-i > len(rb)-j:
		return 1
	}
	return 0
}
