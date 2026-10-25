# Widżety (MCP Apps) — kie MCP

Serwer udostępnia trzy narzędzia z interfejsem w czacie (UI po angielsku) (standard **MCP Apps**, `io.modelcontextprotocol/ui`), który renderuje claude.ai, Claude Desktop i aplikacja mobilna Claude.

| Narzędzie | Zasób UI | Co wysyła do czatu |
|---|---|---|
| `show_candidates` | `ui://kie/candidates.html` | `WYBÓR <decision_id>: <id>` · `WYBÓR <decision_id>: inaczej — <tekst>` · `WYBÓR <decision_id>: żadne — przerysuj` |
| `media_upload_widget` | `ui://kie/upload.html` | `UPLOAD <decision_id>: <url1> · <url2> …` |
| `show_result` | `ui://kie/result.html` | `REF <task_id>: <url>` |
| `media_upload_chunk` | (tylko dla widżetu) | — zapasowy kanał uploadu, ukryty przed modelem (`visibility: ["app"]`) |

Kliknięcie w widżecie wysyła **wiadomość użytkownika** (`ui/message`) w dokładnie jednym z powyższych formatów — nic więcej. Model po wywołaniu narzędzia kończy turę i czyta tę wiadomość.

Zasady:

- Widżety **nie znają klucza Kie** i **nie wołają Kie**. Dostają tylko URL-e. Generuje wyłącznie model, istniejącymi narzędziami.
- Upload: widżet wysyła plik na `POST <serwer>/upload/<ticket>` (jednorazowy, losowy bilet ważny 60 min, limit plików z `max_files`). Serwer sprawdza typ po bajtach (PNG/JPEG/WebP/GIF/HEIC, MP4/MOV/WebM), limit 25 MB obraz / 50 MB wideo, i przekazuje plik do hostingu plików Kie swoim kluczem. Gdy sandbox zablokuje bezpośrednie połączenie, widżet wgrywa plik kawałkami przez `tools/call` → `media_upload_chunk`.
- Teksty w widżetach są po angielsku (przyciski „Choose <id>”, pole „something else: …”, „None — redraw”, „Download”, „Use as reference”). Formaty wiadomości do czatu (`WYBÓR …`, `UPLOAD …`, `REF …`) są niezmienione.
- Telefon: poniżej 600 px siatka ma 2 kolumny. Tryb jasny/ciemny z `hostContext.theme` i zmiennych stylu hosta (fallback: `prefers-color-scheme`).
- Po wysłaniu widżet blokuje przyciski i pokazuje wysłaną wiadomość. Jeśli host odrzuci `ui/message`, widżet pokazuje gotowy tekst do skopiowania.

## Przykłady wywołań

### `show_candidates`

```json
{
  "name": "show_candidates",
  "arguments": {
    "decision_id": "klatka-01",
    "question": "Która klatka idzie do animacji?",
    "candidates": [
      { "id": "A", "url": "https://tempfile.aiquickdraw.com/images/chatgpt/file_00000000255881f5be5ed38a6d5f15fe.png", "kind": "image", "label": "malina, ostre światło" },
      { "id": "B", "url": "https://tempfile.aiquickdraw.com/images/chatgpt/file_000000009604820d8acf7b91d67aacad.png", "kind": "image" },
      { "id": "C", "url": "https://tempfile.aiquickdraw.com/gpt-image-2-5/1792427267997-7iv3vc130rd.png", "kind": "image" },
      { "id": "D", "url": "https://tempfile.aiquickdraw.com/some/clip.mp4", "kind": "video" }
    ],
    "allow_note": true,
    "allow_none": true
  }
}
```

Odpowiedzi w czacie (pole „something else” → `inaczej — …`, „None — redraw” → `żadne — przerysuj`): `WYBÓR klatka-01: B`, `WYBÓR klatka-01: inaczej — jaśniejsze tło`, `WYBÓR klatka-01: żadne — przerysuj`.

### `media_upload_widget`

```json
{
  "name": "media_upload_widget",
  "arguments": {
    "decision_id": "ref-produkt",
    "question": "Wgraj 1–3 zdjęcia produktu",
    "accept": ["image"],
    "max_files": 3
  }
}
```

Odpowiedź w czacie (po osiągnięciu `max_files` wysyła się sama; wcześniej przycisk „Send to chat”):
`UPLOAD ref-produkt: https://tempfile.redpandaai.co/…/a.png · https://tempfile.redpandaai.co/…/b.png`

Te URL-e podajesz dalej jako `input_urls` / `image_urls` do narzędzi generujących.

### `show_result`

```json
{
  "name": "show_result",
  "arguments": { "task_ids": ["fbbe14e17c1eb6da915a9c9ac644e74f", "fb68d8fc85ffb50562c14fc8ddfc986f"] }
}
```

Każdy gotowy wynik ma przyciski „Download” (`ui/download-file`, fallback `ui/open-link`) i „Use as reference”, który wysyła:
`REF fbbe14e17c1eb6da915a9c9ac644e74f: https://tempfile.aiquickdraw.com/images/chatgpt/file_00000000255881f5be5ed38a6d5f15fe.png`.
Zadania w toku mają przycisk „Refresh”.

## Konfiguracja

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `KIE_MCP_WIDGETS` | włączone | `off` wyłącza widżety |
| `KIE_MCP_PUBLIC_URL` | `RENDER_EXTERNAL_URL` → `https://<MCP_ALLOWED_HOSTS[0]>` | publiczny adres serwera (URL uploadu i CSP `connectDomains`) |
| `KIE_MCP_MEDIA_DOMAINS` | — | dodatkowe domeny mediów do CSP (`resourceDomains`), po przecinku, np. `https://cdn.example.com` |

Domyślne domeny mediów: `tempfile.aiquickdraw.com`, `*.aiquickdraw.com`, `*.redpandaai.co`, `*.kie.ai`. Obraz z innej domeny pokaże w kafelku link „Open” zamiast podglądu.

## Test ręczny (claude.ai)

1. Połącz konektor `kie-remote` i otwórz nowy czat.
2. Napisz: *„Wywołaj show_candidates z decision_id `test-1`, pytaniem «Który?» i tymi 4 obrazami jako A–D:”* + 4 URL-e wyników z `list_tasks` (np. te z przykładu wyżej).
3. Claude pyta o zgodę na wyświetlenie aplikacji → **Allow**. W czacie pojawia się siatka 4 obrazów 9:16 z przyciskami „Choose A…D”, polem „something else: …” i przyciskiem „None — redraw”.
4. Kliknij **Choose B**.
5. Oczekiwane: w czacie pojawia się Twoja wiadomość dokładnie `WYBÓR test-1: B`, przyciski w widżecie są zablokowane, a Claude odpowiada na wybór.

Jeśli widżet się nie pojawia, ale narzędzie się wykonało: Claude → Ustawienia → Konektory → `kie-remote` → odłącz i połącz ponownie (odświeża listę narzędzi i zasoby UI), potem nowy czat. Debug: Claude Desktop → Help → Troubleshooting → Enable Developer Mode → `Ctrl/Cmd+Shift+I`.
