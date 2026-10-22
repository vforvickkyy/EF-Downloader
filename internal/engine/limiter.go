package engine

import (
	"context"

	"golang.org/x/time/rate"
)

// Limiter caps the combined speed of all downloads. The cap can change at any
// moment, including mid-download.
type Limiter struct {
	rl *rate.Limiter
}

// NewLimiter returns a limiter; bytesPerSec <= 0 means unlimited.
func NewLimiter(bytesPerSec int64) *Limiter {
	l := &Limiter{rl: rate.NewLimiter(rate.Inf, maxChunk)}
	l.Set(bytesPerSec)
	return l
}

const (
	minChunk = 16 << 10
	maxChunk = 256 << 10
)

// Set changes the cap; bytesPerSec <= 0 removes it.
func (l *Limiter) Set(bytesPerSec int64) {
	if bytesPerSec <= 0 {
		l.rl.SetLimit(rate.Inf)
		l.rl.SetBurst(maxChunk)
		return
	}
	// A burst of ~1/8 s keeps the speed smooth without making every read tiny.
	burst := bytesPerSec / 8
	if burst < minChunk {
		burst = minChunk
	}
	if burst > maxChunk {
		burst = maxChunk
	}
	l.rl.SetLimit(rate.Limit(bytesPerSec))
	l.rl.SetBurst(int(burst))
}

// Chunk is how many bytes to read at a time.
func (l *Limiter) Chunk() int {
	if l.rl.Limit() == rate.Inf {
		return maxChunk
	}
	return l.rl.Burst()
}

// Wait blocks until n more bytes may be transferred.
func (l *Limiter) Wait(ctx context.Context, n int) error {
	for n > 0 {
		if l.rl.Limit() == rate.Inf {
			return nil
		}
		k := n
		if b := l.rl.Burst(); k > b {
			k = b // the cap was lowered after this chunk was read
		}
		if err := l.rl.WaitN(ctx, k); err != nil {
			return err
		}
		n -= k
	}
	return nil
}
