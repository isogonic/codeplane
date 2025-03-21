package logging

var defaultLogger Interface

func Get() Interface {
	if defaultLogger == nil {
		defaultLogger = NewLogger(Options{
			Level: "info",
		})
	}
	return defaultLogger
}
