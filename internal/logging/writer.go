package logging

import (
	"bytes"
	"fmt"
	"time"

	"github.com/go-logfmt/logfmt"
	"github.com/kujtimiihoxha/termai/internal/pubsub"
)

type writer struct {
	messages []Message
	*pubsub.Broker[Message]
}

func (w *writer) Write(p []byte) (int, error) {
	d := logfmt.NewDecoder(bytes.NewReader(p))
	for d.ScanRecord() {
		msg := Message{
			ID: time.Now().Format(time.RFC3339Nano),
		}
		for d.ScanKeyval() {
			switch string(d.Key()) {
			case "time":
				parsed, err := time.Parse(time.RFC3339, string(d.Value()))
				if err != nil {
					return 0, fmt.Errorf("parsing time: %w", err)
				}
				msg.Time = parsed
			case "level":
				msg.Level = string(d.Value())
			case "msg":
				msg.Message = string(d.Value())
			default:
				msg.Attributes = append(msg.Attributes, Attr{
					Key:   string(d.Key()),
					Value: string(d.Value()),
				})
			}
		}
		w.messages = append(w.messages, msg)
		w.Publish(pubsub.CreatedEvent, msg)
	}
	if d.Err() != nil {
		return 0, d.Err()
	}
	return len(p), nil
}
