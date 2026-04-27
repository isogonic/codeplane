# opencode Benchmark-Report: v2.1.0 vs offizielles v1.14.27

Datum: 2026-04-27

## Vergleich

- Meine Version: `v2.1.0`, Commit `95f28931752b6beadb527f6da467d26f85a6cf91`.
- Offizielle neueste GitHub-Release: `anomalyco/opencode v1.14.27`, Tag-Commit `373cc2a5e13ba7b8cc40ff3306c7db023fab370c`.
- Ausfuehrung: source-mode CLI mit `bun --conditions=browser src/index.ts`.
- Isolation: separate temporaere `HOME` und `XDG_*` Profile pro Run, nur opencode-Auth wurde kopiert.
- Modelle fuer die LLM-Aufgabe: `openai/gpt-5.4-mini-fast` und `github-copilot/gpt-5.4-mini`.

## Ergebnis

| Benchmark | Meine v2.1.0 Median | Offiziell v1.14.27 Median | Ergebnis |
| --- | ---: | ---: | --- |
| `cli_version` | 2.50s | 2.40s | v2.1.0 ist 4.3% langsamer |
| `run_help` | 2.56s | 2.51s | v2.1.0 ist 2.1% langsamer |
| `models_openai` | 3.27s | 3.70s | v2.1.0 ist 11.6% schneller |
| `llm_fixture_task` `openai/gpt-5.4-mini-fast` | 34.88s, erfolgreich | 2.38s, fehlgeschlagen | nicht als Latenz vergleichbar |
| `llm_fixture_task` `github-copilot/gpt-5.4-mini` | 24.93s, erfolgreich | 2.49s, fehlgeschlagen | nicht als Latenz vergleichbar |

## Einordnung

Die CLI-Startpfade sind sehr nah beieinander. Meine `v2.1.0` ist in den einfachen source-mode Startpfaden leicht langsamer, aber beim OpenAI-Modelllisting klar schneller.

Die echten LLM-Fixture-Runs haben bei `v2.1.0` fuer beide getesteten Modelle erfolgreich abgeschlossen. Die offizielle `v1.14.27` brach in dieser lokalen source-mode Umgebung vor Abschluss ab, deshalb sind diese roten Balken in der Grafik nur Fehlabbruchszeiten und keine erfolgreichen Modell-Latenzen.

## Artefakte

- `benchmark-chart.svg`: Visualisierung der Mediane.
- `summary.csv`: aggregierte Rohzahlen.
- `results.json`: Einzelruns mit sanierten stdout/stderr Tails.
- `benchmark.ts`: reproduzierbarer Benchmark-Runner.
