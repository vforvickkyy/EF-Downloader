//go:build !windows

package engine

import (
	"errors"
	"syscall"
)

func isDiskFull(err error) bool { return errors.Is(err, syscall.ENOSPC) }
