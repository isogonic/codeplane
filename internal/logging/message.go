package logging

import (
	"time"
)

// Message is the event payload for a log message
type Message struct {
	ID         string
	Time       time.Time
	Level      string
	Message    string `json:"msg"`
	Attributes []Attr
}

type Attr struct {
	Key   string
	Value string
}
