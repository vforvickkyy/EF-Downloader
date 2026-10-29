package main

import (
	"embed"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/src
var assets embed.FS

func main() {
	// The installer runs the app once with this flag to report the
	// installation; no window opens.
	if len(os.Args) > 1 && os.Args[1] == "--report-install" {
		reportInstall()
		return
	}

	app := NewApp()

	theme, appearance := windows.Dark, mac.NSAppearanceNameDarkAqua
	switch app.settings.Theme {
	case "light":
		theme, appearance = windows.Light, mac.NSAppearanceNameAqua
	case "system":
		theme, appearance = windows.SystemDefault, mac.DefaultAppearance
	}
	icon, _ := assets.ReadFile("frontend/src/assets/logo.png")
	webviewData := ""
	if dir, err := os.UserConfigDir(); err == nil {
		webviewData = filepath.Join(dir, "EastapeDownloader", "webview")
	}

	err := wails.Run(&options.App{
		Title:     appName,
		Width:     1180,
		Height:    800,
		MinWidth:  960,
		MinHeight: 640,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 10, G: 10, B: 14, A: 255},
		OnStartup:        app.startup,
		OnBeforeClose:    app.beforeClose,
		OnShutdown:       app.shutdown,
		Bind:             []interface{}{app},
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId:               "eastape-downloader-5f3c9a1e",
			OnSecondInstanceLaunch: app.onSecondInstance,
		},
		// On the Mac, Wails adds the standard app, Edit and Window menus, so
		// copy, paste and quit work with the usual shortcuts.
		Mac: &mac.Options{
			TitleBar:   mac.TitleBarDefault(),
			Appearance: appearance,
			About: &mac.AboutInfo{
				Title:   appName + " " + version,
				Message: slogan + "\n\n" + copyright,
				Icon:    icon,
			},
		},
		Windows: &windows.Options{
			Theme:               theme,
			WebviewUserDataPath: webviewData,
			DisablePinchZoom:    true,
			CustomTheme: &windows.ThemeSettings{
				DarkModeTitleBar:           windows.RGB(12, 12, 17),
				DarkModeTitleBarInactive:   windows.RGB(12, 12, 17),
				DarkModeTitleText:          windows.RGB(232, 232, 240),
				DarkModeTitleTextInactive:  windows.RGB(140, 140, 155),
				DarkModeBorder:             windows.RGB(34, 34, 46),
				DarkModeBorderInactive:     windows.RGB(28, 28, 36),
				LightModeTitleBar:          windows.RGB(247, 247, 251),
				LightModeTitleBarInactive:  windows.RGB(247, 247, 251),
				LightModeTitleText:         windows.RGB(22, 22, 30),
				LightModeTitleTextInactive: windows.RGB(120, 120, 135),
				LightModeBorder:            windows.RGB(220, 220, 230),
				LightModeBorderInactive:    windows.RGB(230, 230, 238),
			},
		},
	})
	if err != nil {
		fatalDialog(appName, "Eastape Downloader couldn't start.\n\nPlease restart your computer and try again. If this keeps happening, reinstall Eastape Downloader or contact support from the Settings screen.")
		os.Exit(1)
	}
}
