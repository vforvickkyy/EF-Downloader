package engine

import (
	"errors"
	"syscall"
)

func isDiskFull(err error) bool {
	const errorDiskFull, errorHandleDiskFull = syscall.Errno(112), syscall.Errno(39)
	return errors.Is(err, errorDiskFull) || errors.Is(err, errorHandleDiskFull)
}
