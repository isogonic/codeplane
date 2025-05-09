package logging

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/go-logfmt/logfmt"
	"github.com/opencode-ai/opencode/internal/session"
)

type writer struct{}

func (w *writer) Write(p []byte) (int, error) {
	d := logfmt.NewDecoder(bytes.NewReader(p))
	for d.ScanRecord() {
		msg := Log{}

		for d.ScanKeyval() {
			switch string(d.Key()) {
			case "time":
				parsed, err := time.Parse(time.RFC3339, string(d.Value()))
				if err != nil {
					return 0, fmt.Errorf("parsing time: %w", err)
				}
				msg.Timestamp = parsed.UnixMilli()
			case "level":
				msg.Level = strings.ToLower(string(d.Value()))
			case "msg":
				msg.Message = string(d.Value())
			default:
				if msg.Attributes == nil {
					msg.Attributes = make(map[string]string)
				}
				msg.Attributes[string(d.Key())] = string(d.Value())
			}
		}

		msg.SessionID = session.CurrentSessionID()
		Create(context.Background(), msg)
	}
	if d.Err() != nil {
		return 0, d.Err()
	}
	return len(p), nil
}

func NewWriter() *writer {
	w := &writer{}
	return w
}
