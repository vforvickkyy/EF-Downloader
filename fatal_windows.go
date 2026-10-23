package main

import (
	"syscall"
	"unsafe"
)

// fatalDialog shows a plain Windows message box, for errors that happen
// before the window exists.
func fatalDialog(title, message string) {
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(message)
	const mbOK, mbIconError = 0x0, 0x10
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), mbOK|mbIconError)
}
