package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	http.HandleFunc("/", status)
	http.HandleFunc("/healthz", status)

	log.Printf("aurora nexus cloud source bridge listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func status(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":          true,
		"service":     "aurora-nexus-source-bridge",
		"environment": "hml",
		"private":     true,
		"timestamp":   time.Now().UTC().Format(time.RFC3339),
	})
}
