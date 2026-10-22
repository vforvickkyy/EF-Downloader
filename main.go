package main

import (
	"embed"
	"log"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/src
var assets embed.FS

func main() {
	app := NewApp()

	theme := windows.Dark
	switch app.settings.Theme {
	case "light":
		theme = windows.Light
	case "system":
		theme = windows.SystemDefault
	}
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
		log.Fatal(err)
	}
}
