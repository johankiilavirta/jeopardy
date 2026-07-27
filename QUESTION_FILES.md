# Question files

Game 0 is a complete, original starter game built into the app for local play.
It remains available with or without a question file. Imported games always
use numbers 1 through N, and random selection prefers those imported games when
available.

The mobile app ships without the repository's question archive. On the main
menu, open **Settings → Question File → Load JSON Files**. You can select either
one combined archive or multiple season files. Every selected file must contain
one JSON array of the existing `GameData` objects:

```json
[
  {
    "gameNumber": 1,
    "airDate": "1984-09-10",
    "round1": [
      {
        "name": "CATEGORY",
        "clues": [
          { "value": 200, "text": "Clue text", "answer": "Correct response" }
        ]
      }
    ],
    "round2": [],
    "final": {
      "category": "FINAL CATEGORY",
      "text": "Final clue",
      "answer": "Final response"
    }
  }
]
```

The picker order and filenames do not control game order. The importer sorts all
selected games by `airDate` (oldest first), then by their existing `gameNumber`,
filename, and position within the source file. It writes a single private copy
inside the app and assigns consecutive library game numbers starting at 1.
Overlapping files containing the same date and game number are rejected.

The private copy is indexed by byte range, so only the selected game is parsed
during lobby/gameplay. Once import completes, the original downloads can move
or be deleted without affecting the app.

For private development, `npm run export-questions` combines the existing
per-season repository files into:

`private-question-files/jeopardy-games.json`

That directory is gitignored and is not referenced by the Metro application
graph.

Online play is disabled by default. Development builds can restore the existing
relay UI and behavior with:

`EXPO_PUBLIC_ENABLE_ONLINE=1`
