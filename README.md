# DPD Stopy - Asystent Kuriera

Aplikacja typu PWA (Progressive Web App) przeznaczona dla kurierów DPD do ewidencjonowania odwiedzonych punktów (stopów), zarządzania notatkami oraz rozliczeń finansowych (napiwki).

## 🎯 Główne Cele
*   **Ewidencja:** Szybkie zapisywanie odwiedzonych adresów (Doręczenie/Odbiór).
*   **Rozliczenia:** Śledzenie napiwków i podsumowania dzienne/miesięczne.
*   **Offline First:** Działanie bez dostępu do internetu (zapis danych w LocalStorage).
*   **Voice-to-Text:** Wykorzystanie AI do głosowego wprowadzania adresów i notatek.

## 🛠 Technologia
Aplikacja zbudowana jest w oparciu o standardy webowe, bez frameworków (Vanilla JS), co zapewnia maksymalną szybkość i kompatybilność.

*   **HTML5 / CSS3 (Tailwind CSS)** - Interfejs użytkownika.
*   **JavaScript (ES6+)** - Logika aplikacji.
*   **PWA (Manifest + Service Worker)** - Obsługa instalacji na telefonie i trybu offline.
*   **LocalStorage** - Przechowywanie danych w pamięci przeglądarki (brak zewnętrznej bazy danych).
*   **Leaflet / OpenStreetMap** - Wizualizacja punktów na mapie (opcjonalnie).
*   **AI Integration** - Obsługa API (Groq, OpenAI, Gemini) do analizy mowy.

## 📂 Struktura Plików

```text
z:\WWW\stopy\
├── index.html              # Główny plik widoku aplikacji
├── manifest.json           # Konfiguracja PWA (ikony, nazwa, kolory)
├── sw.js                   # Service Worker (cache, offline)
├── css\
│   └── style.css           # Style niestandardowe (uzupełnienie Tailwind)
├── js\
│   ├── app.js              # Główna logika (UI, AI, LocalStorage, Mapa)
│   └── tailwind-config.js  # Konfiguracja motywu kolorystycznego DPD
└── assets\
    └── icon.svg            # Ikona aplikacji
```

## 🚀 Funkcjonalności

### 1. Rejestracja Stopów (Głosowa i Ręczna)
*   Przycisk mikrofonu pozwala podyktować adres i notatkę (np. *"Polna 5 zostawione u sąsiada 20 złotych napiwku"*).
*   AI (lub prosty parser) analizuje tekst i wyciąga:
    *   **Adres:** Polna 5
    *   **Notatkę:** zostawione u sąsiada
    *   **Napiwek:** 20.00 zł
    *   **Typ:** Doręczenie (domyślnie) lub Odbiór.

### 2. Historia i Rozliczenia
*   Lista odwiedzonych punktów z podziałem na dni.
*   **Podsumowanie dnia:** Liczba doręczeń, odbiorów oraz suma napiwków.
*   Edycja i usuwanie wpisów.
*   Eksport danych do CSV (pełna historia) oraz JSON (backup).

### 3. Ustawienia i Konfiguracja
*   Wybór dostawcy AI (Groq, OpenAI, Gemini, Together, HuggingFace).
*   Zarządzanie kluczami API.
*   Ustawienia motywu (Jasny/Ciemny/Auto).
*   Zarządzanie miastem domyślnym (do geokodowania).
*   **Always On Display:** Opcja blokady wygaszania ekranu (Wake Lock) podczas używania aplikacji.
*   **Statystyki:** Wykresy liczby stopów i sumy napiwków z ostatnich 7 dni.

### 4. Inteligentny Asystent Samochodowy (CarAssistant)
*   **Wykrywanie silnika:** Automatyczne przypomnienie o dodaniu adresu po uruchomieniu silnika (wykrycie ładowania).
*   **Wykrywanie ruchu:** Przypomnienie po ruszeniu z miejsca (> 7 km/h), jeśli zapomniano dodać stop.
*   **Interakcja głosowa:** Komunikat "Dodaj adres" i automatyczne uruchomienie nasłuchiwania.
*   **Inteligentne warunki:** Ochrona przed zbędnym uruchamianiem (sprawdzanie czasu od ostatniego wpisu).

### 5. Baza Klientów
*   **Zapis danych:** Przechowywanie stałych klientów (Imię, Telefon, Notatka) powiązanych z adresem.
*   **Automatyzacja:** Automatyczne wykrywanie klienta przy dodawaniu stopu pod znanym adresem.
*   **UI:** Wyświetlanie danych klienta bezpośrednio na liście stopów (wyróżnienie kolorem).
*   **Szybki kontakt:** Przycisk "Zadzwoń" przy rozpoznanym numerze telefonu.
*   **Zarządzanie:** Dedykowany widok do edycji i przeglądania bazy klientów.

## 📦 Instalacja

### Wymagania
*   Serwer WWW (lokalny lub zdalny) wymagany dla Service Workera i HTTPS (wymagane dla mikrofonu na mobile).
*   Dla testów lokalnych: `python -m http.server` lub Live Server w VS Code.

### Uruchomienie
1.  Skopiuj pliki na serwer.
2.  Otwórz adres w przeglądarce (Chrome na Android, Safari na iOS).
3.  **Android:** Kliknij "Dodaj do ekranu głównego" na pasku powiadomień.
4.  **iOS:** Kliknij "Udostępnij" -> "Do ekranu początkowego".

## 🔒 Bezpieczeństwo Danych
*   Wszystkie dane (adresy, klucze API) są przechowywane **lokalnie** na urządzeniu użytkownika (LocalStorage).
*   Aplikacja nie wysyła danych na zewnętrzne serwery (poza zapytaniami do wybranych API AI i geokodowania).
*   Zalecane jest regularne robienie **Backupu** (Ustawienia -> Eksportuj backup).

## 🔄 Historia Zmian
*   **Refaktoryzacja:** Podział monolitu na strukturę modułową (css/js).
*   **Raportowanie:** Dodano eksport pełnej historii do CSV.
*   **UX:** Dodano podsumowania finansowe (napiwki) bezpośrednio na liście historii.
*   **System:** Dodano obsługę Screen Wake Lock API (blokada wygaszania ekranu).
*   **Smart:** Dodano moduł CarAssistant wykrywający powrót do auta (ładowanie) i ruch (GPS) w celu automatycznego wywołania zapisu.
*   **UI:** Wydzielono zaawansowane ustawienia AI do dedykowanej podstrony.
*   **Fix (iOS):** Naprawiono widoczność checkboxów w ustawieniach na iPhone (problem ze stylami systemowymi).
*   **Moduł:** Dodano Bazę Klientów z automatycznym rozpoznawaniem adresów, stałymi notatkami i szybkim wybieraniem numeru.
*   **Fix (Voice):** Naprawiono potwierdzenia głosowe (TTS) na iOS (dodano "warm-up" syntezatora) i Chrome.
