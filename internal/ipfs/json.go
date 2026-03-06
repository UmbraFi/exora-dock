package ipfs

import (
	"encoding/json"
	"io"
)

func readJSON(r io.Reader, v any) error {
	return json.NewDecoder(r).Decode(v)
}
