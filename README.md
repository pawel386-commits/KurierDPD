# Kurier Log AI - Asystent Kuriera DPD

Aplikacja PWA (Progressive Web App) wspomagająca pracę kuriera, umożliwiająca szybkie rejestrowanie stopów, zarządzanie bazą klientów oraz inteligentne wsparcie w trasie dzięki integracji z AI i geolokalizacją.

## 🚀 Główne Funkcje

### 🎙️ Obsługa Głosowa
- **Rozpoznawanie mowy:** Szybkie dodawanie adresów i notatek za pomocą głosu.
- **Synteza mowy:** Komunikaty głosowe asystenta (np. potwierdzenie dodania, sugestie).
- **Pulsowanie:** Wizualna sygnalizacja nasłuchiwania.

### 🧠 Integracja AI
- **Analiza notatek:** Inteligentne przetwarzanie dyktowanych notatek w celu wyodrębnienia adresu i instrukcji.
- **Wsparcie wielu dostawców:**
  - Groq (domyślny, szybki)
  - Google Gemini
  - OpenAI
  - Together AI
  - Hugging Face

### 🗺️ Mapy i Geolokalizacja
- **Interaktywna mapa:** Podgląd lokalizacji klienta (Leaflet + OpenStreetMap).
- **Geokodowanie:** Automatyczna zamiana adresu na współrzędne GPS (Nominatim).
- **Smart Assistant:** Sugerowanie klientów na podstawie aktualnej lokalizacji (Geofencing).
- **Edycja pozycji:** Możliwość ręcznego przesuwania pinezki (Drag & Drop).

### 🚗 Car Assistant
- **Wykrywanie powrotu do auta:** Automatyczne uruchamianie nasłuchiwania po wykryciu podłączenia ładowania (Android) lub ruszenia z miejsca (GPS speed > 1.95 m/s).
- **Wake Lock:** Zapobieganie wygaszaniu ekranu podczas pracy.

### 👥 Baza Klientów
- **Zapisywanie klientów:** Historia odwiedzonych adresów.
- **Stałe notatki:** Kody do bram, preferencje doręczenia przypisane do adresu.
- **Szybkie wybieranie:** Bezpośrednie połączenia telefoniczne z aplikacji.

### 📍 Mój Rejon
- **Dedykowany widok:** Zarządzanie listą ulic w rejonie w osobnej zakładce.
- **Lista ulic:** Przejrzysta lista kafelkowa z możliwością dodawania, edycji i usuwania ulic.
- **Weryfikacja:** System oznacza adresy spoza zdefiniowanego rejonu.
 - **Backup rejonu:** Eksport i import listy ulic rejonu do osobnego pliku JSON.

### ⚡ Analiza Trasy (Master Route)
- **Generowanie idealnej trasy:** Algorytm analizuje całą historię dostaw i tworzy optymalny schemat kolejności ulic.
- **Segmentacja (Jodełka):** Wykrywanie podziału ulic na segmenty (np. Ulica X 1-10 -> Ulica Y -> Ulica X 11-20).
- **Mikro-logistyka:** Automatyczne wykrywanie kierunku poruszania się (rosnąco/malejąco) po numerach domów.
- **Relatywny czas:** Obliczanie średniego postępu trasy dla każdego adresu (0-100%).

### 📊 Statystyki i Historia
- **Wykresy:** Wizualizacja liczby stopów i napiwków (Chart.js).
- **Eksport danych:** Generowanie raportów CSV oraz pełny backup JSON.
- **Historia dzienna:** Lista odwiedzonych punktów z możliwością edycji.

## 🛠️ Technologie

Projekt zbudowany w oparciu o nowoczesne standardy webowe (Vanilla JS):

- **Frontend:** HTML5, Tailwind CSS (CDN).
- **Logika:** JavaScript (ES6+).
- **Mapy:** Leaflet.js.
- **Ikony:** Lucide Icons.
- **Wykresy:** Chart.js.
- **PWA:** Service Worker, Web App Manifest (działa offline).
- **Baza danych:** LocalStorage (dane przechowywane lokalnie w urządzeniu).

## 📂 Struktura Projektu

```text
z:\WWW\stopy\
├── css\
│   └── style.css       # Style globalne i poprawki dla map/mobile
├── js\
│   ├── app.js          # Główna logika aplikacji (2300+ linii)
│   └── route_analysis.js # Moduł algorytmu Analizy Trasy (Master Route)
├── assets\             # Ikony i zasoby graficzne
├── index.html          # Główny widok aplikacji (Single Page)
├── manifest.json       # Konfiguracja PWA
├── sw.js               # Service Worker (Cache & Offline)
└── README.md           # Dokumentacja projektu
```

## � Instalacja

### Wymagania
- Przeglądarka wspierająca nowoczesne standardy (Chrome, Edge, Safari).
- Dla pełnej funkcjonalności (Car Assistant): Android z Chrome (Battery API).

### Uruchomienie lokalne
Ze względu na politykę bezpieczeństwa przeglądarek (CORS, moduły), aplikacja powinna być serwowana przez serwer HTTP, a nie bezpośrednio z pliku.

```bash
# Przykład z Python
python -m http.server 8000
```
Następnie otwórz `http://localhost:8000` w przeglądarce.

### Instalacja jako Aplikacja (PWA)
1. Otwórz stronę w przeglądarce na telefonie.
2. Wybierz opcję "Dodaj do ekranu głównego" (Add to Home Screen).
3. Aplikacja zainstaluje się jako natywna aplikacja systemowa.

## ⚙️ Konfiguracja AI

Aby korzystać z funkcji AI, przejdź do Ustawień AI i wybierz dostawcę:
1. **Groq:** Wymaga klucza API (szybki, darmowy limit).
2. **Gemini:** Wymaga klucza Google AI Studio.
3. **OpenAI:** Wymaga płatnego klucza API.
4. **Tryb parsowania głosowego:** AI służy głównie do wyciągania notatek i napiwków; adres jest parsowany lokalnie przez wewnętrzny algorytm, aby uniknąć zmiany numeru domu przez model.

## 🔒 Prywatność

Aplikacja działa w modelu **Local-First**. Wszystkie dane (klienci, historia, ustawienia) są przechowywane w pamięci przeglądarki (LocalStorage) i nie są wysyłane na żaden zewnętrzny serwer (poza zapytaniami do API AI i Geocodingu, które są anonimizowane w miarę możliwości).

---
Autor: DPD Stopy Dev Team
Ostatnia aktualizacja: Styczeń 2026
