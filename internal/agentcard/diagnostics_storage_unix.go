//go:build darwin || linux

package agentcard

import (
	"os"
	"syscall"
)

func storageInfo() []StorageInfo {
	wd, err := os.Getwd()
	if err != nil || wd == "" {
		wd = "."
	}
	var stat syscall.Statfs_t
	if err := syscall.Statfs(wd, &stat); err != nil {
		return nil
	}
	blockSize := uint64(stat.Bsize)
	total := stat.Blocks * blockSize
	free := stat.Bavail * blockSize
	return storageFromBytes(total, free)
}
