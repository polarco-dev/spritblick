<?php

declare(strict_types=1);

const TANKERKOENIG_API_BASE = 'https://creativecommons.tankerkoenig.de/json/';
const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const DEFAULT_FUEL = 'e5';
const DEFAULT_RADIUS_KM = 5.0;
const DEFAULT_RESULT_LIMIT = 30;
const MAX_RESULT_LIMIT = 60;
const MIN_RADIUS_KM = 1.0;
const MAX_RADIUS_KM = 25.0;
const MAX_IDS_PER_PRICE_REQUEST = 10;
const MAX_IDS_TOTAL = 60;
const REQUEST_TIMEOUT_SECONDS = 15;
const SEARCH_CACHE_TTL_SECONDS = 120;
const GEOCODE_CACHE_TTL_SECONDS = 86400;
const PRICE_STALE_CACHE_MAX_AGE_SECONDS = 20 * 60;
const CACHE_FILE = __DIR__ . DIRECTORY_SEPARATOR . 'price-cache.json';
const LOCAL_KEY_FILE = __DIR__ . DIRECTORY_SEPARATOR . 'tankerkoenig.key';
const APP_USER_AGENT = 'spritblick/2.0 (+https://polarco.de)';
const TANKERKOENIG_LICENSE = 'CC BY 4.0 - https://creativecommons.tankerkoenig.de';

send_no_cache_headers();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    send_json(405, ['error' => 'Method Not Allowed']);
}

$cache = load_cache();

try {
    $action = strtolower(trim((string) ($_GET['action'] ?? 'prices')));

    switch ($action) {
        case 'search':
            $payload = handle_search_action(resolve_api_key(), $cache);
            break;
        case 'nearby':
            $payload = handle_nearby_action(resolve_api_key(), $cache);
            break;
        case 'prices':
            $payload = handle_prices_action(resolve_api_key(), $cache);
            break;
        default:
            throw new ApiException(400, 'Ungültige action. Erlaubt: search, nearby, prices');
    }

    persist_cache($cache);
    send_json(200, $payload);
} catch (ApiException $exception) {
    persist_cache($cache);
    send_json($exception->statusCode, ['error' => $exception->getMessage()]);
} catch (Throwable $exception) {
    persist_cache($cache);
    send_json(500, ['error' => 'Interner Fehler beim API-Abruf']);
}

function handle_search_action(string $apiKey, array &$cache): array
{
    $query = trim((string) ($_GET['q'] ?? ''));
    if ($query === '') {
        throw new ApiException(400, 'Bitte q (Ort, Adresse oder PLZ) angeben');
    }

    $fuel = parse_fuel($_GET['fuel'] ?? null);
    $radius = parse_radius($_GET['radius'] ?? null);
    $limit = parse_limit($_GET['limit'] ?? null);

    $location = geocode_query($query, $cache);
    $searchResult = fetch_station_list($apiKey, $location['lat'], $location['lng'], $radius, $cache);
    $stations = normalize_list_stations($searchResult['stations'], $fuel, $limit);

    return [
        'ok' => true,
        'action' => 'search',
        'fetchedAt' => gmdate('c'),
        'fuel' => $fuel,
        'query' => $query,
        'radius' => $radius,
        'location' => [
            'label' => $location['label'],
            'lat' => $location['lat'],
            'lng' => $location['lng'],
        ],
        'source' => $searchResult['source'],
        'stations' => $stations,
        'count' => count($stations),
        'license' => TANKERKOENIG_LICENSE,
    ];
}

function handle_nearby_action(string $apiKey, array &$cache): array
{
    $lat = parse_float_param($_GET['lat'] ?? null, 'lat');
    $lng = parse_float_param($_GET['lng'] ?? null, 'lng');
    $fuel = parse_fuel($_GET['fuel'] ?? null);
    $radius = parse_radius($_GET['radius'] ?? null);
    $limit = parse_limit($_GET['limit'] ?? null);

    $searchResult = fetch_station_list($apiKey, $lat, $lng, $radius, $cache);
    $stations = normalize_list_stations($searchResult['stations'], $fuel, $limit);

    return [
        'ok' => true,
        'action' => 'nearby',
        'fetchedAt' => gmdate('c'),
        'fuel' => $fuel,
        'radius' => $radius,
        'location' => [
            'label' => sprintf('%.5f, %.5f', $lat, $lng),
            'lat' => $lat,
            'lng' => $lng,
        ],
        'source' => $searchResult['source'],
        'stations' => $stations,
        'count' => count($stations),
        'license' => TANKERKOENIG_LICENSE,
    ];
}

function handle_prices_action(string $apiKey, array &$cache): array
{
    $ids = parse_station_ids($_GET['ids'] ?? null);
    if ($ids === []) {
        throw new ApiException(400, 'Bitte mindestens eine gültige Station-ID in ids angeben');
    }

    if (count($ids) > MAX_IDS_TOTAL) {
        throw new ApiException(400, 'Zu viele IDs. Maximal ' . MAX_IDS_TOTAL . ' pro Anfrage');
    }

    $fuel = parse_fuel($_GET['fuel'] ?? null);
    $stations = fetch_prices_for_ids($apiKey, $ids, $fuel, $cache);

    return [
        'ok' => true,
        'action' => 'prices',
        'fetchedAt' => gmdate('c'),
        'fuel' => $fuel,
        'stations' => $stations,
        'count' => count($stations),
        'license' => TANKERKOENIG_LICENSE,
    ];
}

function resolve_api_key(): string
{
    $candidates = [
        getenv('TANKERKOENIG_API_KEY') ?: '',
        (string) ($_SERVER['TANKERKOENIG_API_KEY'] ?? ''),
        is_file(LOCAL_KEY_FILE) ? (string) @file_get_contents(LOCAL_KEY_FILE) : '',
    ];

    foreach ($candidates as $candidate) {
        $key = trim($candidate);
        if ($key !== '') {
            return $key;
        }
    }

    throw new ApiException(
        500,
        'Kein API-Key gefunden. Setze TANKERKOENIG_API_KEY oder lege api/tankerkoenig.key an'
    );
}

function parse_fuel($rawFuel): string
{
    $fuel = strtolower(trim((string) ($rawFuel ?? DEFAULT_FUEL)));
    $allowed = ['e5', 'e10', 'diesel'];

    if (!in_array($fuel, $allowed, true)) {
        throw new ApiException(400, 'Ungültiger fuel-Wert. Erlaubt: e5, e10, diesel');
    }

    return $fuel;
}

function parse_radius($rawRadius): float
{
    if ($rawRadius === null || $rawRadius === '') {
        return DEFAULT_RADIUS_KM;
    }

    if (!is_scalar($rawRadius) || !is_numeric((string) $rawRadius)) {
        throw new ApiException(400, 'Ungültiger radius-Wert');
    }

    $radius = (float) $rawRadius;
    if ($radius < MIN_RADIUS_KM || $radius > MAX_RADIUS_KM) {
        throw new ApiException(400, 'radius muss zwischen ' . MIN_RADIUS_KM . ' und ' . MAX_RADIUS_KM . ' liegen');
    }

    return $radius;
}

function parse_limit($rawLimit): int
{
    if ($rawLimit === null || $rawLimit === '') {
        return DEFAULT_RESULT_LIMIT;
    }

    if (!is_scalar($rawLimit) || !preg_match('/^\d+$/', (string) $rawLimit)) {
        throw new ApiException(400, 'Ungültiger limit-Wert');
    }

    $limit = (int) $rawLimit;
    if ($limit < 1) {
        return 1;
    }

    return min($limit, MAX_RESULT_LIMIT);
}

function parse_station_ids($rawIds): array
{
    if ($rawIds === null || $rawIds === '') {
        return [];
    }

    $parts = is_array($rawIds) ? $rawIds : explode(',', (string) $rawIds);
    $normalized = [];

    foreach ($parts as $part) {
        $id = strtolower(trim((string) $part));
        if ($id === '') {
            continue;
        }

        if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $id)) {
            throw new ApiException(400, 'Ungültige Station-ID: ' . $id);
        }

        $normalized[$id] = true;
    }

    return array_keys($normalized);
}

function parse_float_param($value, string $name): float
{
    if ($value === null || $value === '') {
        throw new ApiException(400, 'Fehlender Parameter: ' . $name);
    }

    if (!is_scalar($value) || !is_numeric((string) $value)) {
        throw new ApiException(400, 'Ungültiger Parameter: ' . $name);
    }

    return (float) $value;
}

function geocode_query(string $query, array &$cache): array
{
    $key = sha1(strtolower(trim($query)));
    $cached = $cache['geocode'][$key] ?? null;

    if (is_array($cached)) {
        $cachedAt = (int) ($cached['cachedAt'] ?? 0);
        if ((time() - $cachedAt) <= GEOCODE_CACHE_TTL_SECONDS) {
            return [
                'lat' => (float) ($cached['lat'] ?? 0.0),
                'lng' => (float) ($cached['lng'] ?? 0.0),
                'label' => (string) ($cached['label'] ?? $query),
            ];
        }
    }

    $params = [
        'format' => 'jsonv2',
        'limit' => 1,
        'addressdetails' => 0,
        'countrycodes' => 'de',
        'accept-language' => 'de',
        'q' => $query,
    ];

    $url = NOMINATIM_SEARCH_URL . '?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
    $payload = fetch_json_from_url($url, REQUEST_TIMEOUT_SECONDS, [
        'User-Agent' => APP_USER_AGENT,
        'Accept' => 'application/json',
    ]);

    if (!is_array($payload) || $payload === []) {
        throw new ApiException(404, 'Ort/Adresse konnte nicht aufgelöst werden');
    }

    $first = $payload[0] ?? null;
    if (!is_array($first) || !isset($first['lat'], $first['lon'])) {
        throw new ApiException(404, 'Keine Koordinaten für Suchbegriff gefunden');
    }

    $location = [
        'lat' => (float) $first['lat'],
        'lng' => (float) $first['lon'],
        'label' => trim((string) ($first['display_name'] ?? $query)),
    ];

    $cache['geocode'][$key] = [
        'lat' => $location['lat'],
        'lng' => $location['lng'],
        'label' => $location['label'],
        'cachedAt' => time(),
    ];

    return $location;
}

function fetch_station_list(string $apiKey, float $lat, float $lng, float $radius, array &$cache): array
{
    $cacheKey = sprintf('%.5f|%.5f|%.2f', $lat, $lng, $radius);
    $cached = $cache['search'][$cacheKey] ?? null;

    if (is_array($cached)) {
        $cachedAt = (int) ($cached['cachedAt'] ?? 0);
        $stations = $cached['stations'] ?? null;
        if ((time() - $cachedAt) <= SEARCH_CACHE_TTL_SECONDS && is_array($stations)) {
            return [
                'source' => 'cache',
                'stations' => $stations,
            ];
        }
    }

    $payload = tankerkoenig_request($apiKey, 'list.php', [
        'lat' => $lat,
        'lng' => $lng,
        'rad' => $radius,
        'sort' => 'dist',
        'type' => 'all',
    ]);

    $stations = $payload['stations'] ?? null;
    if (!is_array($stations)) {
        throw new ApiException(502, 'Tankerkönig-Liste ist ungültig');
    }

    $cache['search'][$cacheKey] = [
        'stations' => $stations,
        'cachedAt' => time(),
    ];

    return [
        'source' => 'live',
        'stations' => $stations,
    ];
}

function normalize_list_stations(array $stations, string $fuel, int $limit): array
{
    $normalized = [];

    foreach ($stations as $station) {
        if (!is_array($station)) {
            continue;
        }

        $stationId = strtolower(trim((string) ($station['id'] ?? '')));
        if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $stationId)) {
            continue;
        }

        $prices = [
            'e5' => normalize_price_value($station['e5'] ?? null),
            'e10' => normalize_price_value($station['e10'] ?? null),
            'diesel' => normalize_price_value($station['diesel'] ?? null),
        ];

        $name = trim((string) ($station['name'] ?? 'Tankstelle'));
        $brand = trim((string) ($station['brand'] ?? ''));
        $street = trim((string) ($station['street'] ?? ''));
        $houseNumber = trim((string) ($station['houseNumber'] ?? ''));
        $place = trim((string) ($station['place'] ?? ''));

        $normalized[] = [
            'id' => $stationId,
            'name' => $name !== '' ? $name : ($brand !== '' ? $brand : 'Tankstelle'),
            'brand' => $brand,
            'street' => $street,
            'houseNumber' => $houseNumber,
            'postCode' => isset($station['postCode']) ? (int) $station['postCode'] : null,
            'place' => $place,
            'lat' => isset($station['lat']) ? (float) $station['lat'] : null,
            'lng' => isset($station['lng']) ? (float) $station['lng'] : null,
            'dist' => isset($station['dist']) ? (float) $station['dist'] : null,
            'isOpen' => isset($station['isOpen']) ? (bool) $station['isOpen'] : null,
            'prices' => $prices,
            'selectedPrice' => $prices[$fuel],
        ];
    }

    usort($normalized, static function (array $left, array $right) use ($fuel): int {
        $leftPrice = $left['selectedPrice'];
        $rightPrice = $right['selectedPrice'];

        $leftComparable = is_numeric($leftPrice) ? (float) $leftPrice : INF;
        $rightComparable = is_numeric($rightPrice) ? (float) $rightPrice : INF;

        if ($leftComparable !== $rightComparable) {
            return $leftComparable <=> $rightComparable;
        }

        $leftDist = is_numeric($left['dist']) ? (float) $left['dist'] : INF;
        $rightDist = is_numeric($right['dist']) ? (float) $right['dist'] : INF;
        if ($leftDist !== $rightDist) {
            return $leftDist <=> $rightDist;
        }

        return strcmp((string) $left['name'], (string) $right['name']);
    });

    return array_slice($normalized, 0, $limit);
}

function fetch_prices_for_ids(string $apiKey, array $ids, string $fuel, array &$cache): array
{
    $resultsById = [];
    $chunks = array_chunk($ids, MAX_IDS_PER_PRICE_REQUEST);

    foreach ($chunks as $chunk) {
        try {
            $payload = tankerkoenig_request($apiKey, 'prices.php', [
                'ids' => implode(',', $chunk),
            ]);

            $priceMap = $payload['prices'] ?? null;
            if (!is_array($priceMap)) {
                throw new ApiException(502, 'Tankerkönig-Preisantwort ist ungültig');
            }

            foreach ($chunk as $id) {
                $entry = $priceMap[$id] ?? null;
                if (!is_array($entry)) {
                    $resultsById[$id] = fallback_or_error_for_id($id, $fuel, $cache, 'Preis nicht vorhanden');
                    continue;
                }

                $normalized = normalize_price_entry($id, $entry, $fuel);
                remember_price_snapshot($cache, $normalized);
                $resultsById[$id] = $normalized;
            }
        } catch (Throwable $exception) {
            foreach ($chunk as $id) {
                $resultsById[$id] = fallback_or_error_for_id(
                    $id,
                    $fuel,
                    $cache,
                    'Preisabruf fehlgeschlagen'
                );
            }
        }
    }

    $ordered = [];
    foreach ($ids as $id) {
        if (isset($resultsById[$id])) {
            $ordered[] = $resultsById[$id];
        }
    }

    return $ordered;
}

function normalize_price_entry(string $id, array $entry, string $fuel): array
{
    $status = strtolower(trim((string) ($entry['status'] ?? 'unknown')));
    $prices = [
        'e5' => normalize_price_value($entry['e5'] ?? null),
        'e10' => normalize_price_value($entry['e10'] ?? null),
        'diesel' => normalize_price_value($entry['diesel'] ?? null),
    ];

    return [
        'id' => $id,
        'ok' => true,
        'source' => 'live',
        'status' => $status,
        'isOpen' => $status === 'open',
        'prices' => $prices,
        'selectedPrice' => $prices[$fuel],
    ];
}

function remember_price_snapshot(array &$cache, array $station): void
{
    if (($station['ok'] ?? false) !== true || !isset($station['id'])) {
        return;
    }

    $id = strtolower(trim((string) $station['id']));
    if ($id === '') {
        return;
    }

    $cache['prices'][$id] = [
        'prices' => is_array($station['prices'] ?? null) ? $station['prices'] : [],
        'status' => (string) ($station['status'] ?? 'unknown'),
        'cachedAt' => time(),
    ];
}

function fallback_or_error_for_id(string $id, string $fuel, array &$cache, string $error): array
{
    $cached = $cache['prices'][$id] ?? null;
    if (!is_array($cached)) {
        return [
            'id' => $id,
            'ok' => false,
            'error' => $error,
        ];
    }

    $cachedAt = (int) ($cached['cachedAt'] ?? 0);
    if ((time() - $cachedAt) > PRICE_STALE_CACHE_MAX_AGE_SECONDS) {
        unset($cache['prices'][$id]);
        return [
            'id' => $id,
            'ok' => false,
            'error' => $error,
        ];
    }

    $prices = is_array($cached['prices'] ?? null) ? $cached['prices'] : [];
    $normalizedPrices = [
        'e5' => normalize_price_value($prices['e5'] ?? null),
        'e10' => normalize_price_value($prices['e10'] ?? null),
        'diesel' => normalize_price_value($prices['diesel'] ?? null),
    ];
    $status = strtolower(trim((string) ($cached['status'] ?? 'unknown')));

    return [
        'id' => $id,
        'ok' => true,
        'source' => 'cache',
        'stale' => true,
        'cachedAt' => gmdate('c', $cachedAt),
        'status' => $status,
        'isOpen' => $status === 'open',
        'prices' => $normalizedPrices,
        'selectedPrice' => $normalizedPrices[$fuel],
    ];
}

function normalize_price_value($value): ?float
{
    if (is_numeric($value)) {
        return (float) number_format((float) $value, 3, '.', '');
    }

    return null;
}

function tankerkoenig_request(string $apiKey, string $endpoint, array $params): array
{
    $query = $params;
    $query['apikey'] = $apiKey;

    $url = TANKERKOENIG_API_BASE . ltrim($endpoint, '/');
    $url .= '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);

    $payload = fetch_json_from_url($url, REQUEST_TIMEOUT_SECONDS, [
        'User-Agent' => APP_USER_AGENT,
        'Accept' => 'application/json',
    ]);

    if (!is_array($payload)) {
        throw new ApiException(502, 'Ungültige Antwort von Tankerkönig');
    }

    if (($payload['ok'] ?? false) !== true) {
        $status = (string) ($payload['status'] ?? 'error');
        throw new ApiException(502, 'Tankerkönig-Fehler: ' . $status);
    }

    return $payload;
}

function fetch_json_from_url(string $url, int $timeoutSeconds, array $headers = [])
{
    $raw = fetch_text($url, $timeoutSeconds, $headers);
    $decoded = json_decode($raw, true);

    if (json_last_error() !== JSON_ERROR_NONE) {
        throw new ApiException(502, 'Antwort konnte nicht als JSON gelesen werden');
    }

    return $decoded;
}

function fetch_text(string $url, int $timeoutSeconds, array $headers = []): string
{
    if (function_exists('curl_init')) {
        $handle = curl_init($url);
        if ($handle === false) {
            throw new ApiException(500, 'cURL konnte nicht initialisiert werden');
        }

        curl_setopt_array($handle, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => $timeoutSeconds,
            CURLOPT_TIMEOUT => $timeoutSeconds,
            CURLOPT_HTTPHEADER => normalize_headers($headers),
            CURLOPT_ENCODING => '',
        ]);

        $body = curl_exec($handle);
        $statusCode = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
        $errorCode = curl_errno($handle);
        $errorMessage = curl_error($handle);
        curl_close($handle);

        if ($errorCode !== 0 || !is_string($body)) {
            throw new ApiException(502, $errorMessage !== '' ? $errorMessage : 'Externer API-Aufruf fehlgeschlagen');
        }

        if ($statusCode < 200 || $statusCode >= 300) {
            throw new ApiException(502, 'Externe API antwortete mit HTTP ' . $statusCode);
        }

        return $body;
    }

    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => $timeoutSeconds,
            'ignore_errors' => true,
            'header' => implode("\r\n", normalize_headers($headers)),
        ],
        'ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
        ],
    ]);

    $body = @file_get_contents($url, false, $context);
    if ($body === false) {
        throw new ApiException(502, 'Externer API-Aufruf fehlgeschlagen');
    }

    $statusCode = 0;
    foreach ($http_response_header ?? [] as $line) {
        if (preg_match('/^HTTP\/\S+\s+(\d{3})/', (string) $line, $matches)) {
            $statusCode = (int) $matches[1];
        }
    }

    if ($statusCode < 200 || $statusCode >= 300) {
        throw new ApiException(502, 'Externe API antwortete mit HTTP ' . $statusCode);
    }

    return $body;
}

function normalize_headers(array $headers): array
{
    $normalized = [];
    foreach ($headers as $key => $value) {
        if (is_int($key)) {
            $normalized[] = (string) $value;
            continue;
        }

        $normalized[] = (string) $key . ': ' . (string) $value;
    }

    return $normalized;
}

function load_cache(): array
{
    $default = [
        'version' => 2,
        'geocode' => [],
        'search' => [],
        'prices' => [],
    ];

    if (!is_file(CACHE_FILE)) {
        return $default;
    }

    $raw = @file_get_contents(CACHE_FILE);
    if (!is_string($raw) || $raw === '') {
        return $default;
    }

    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        return $default;
    }

    return [
        'version' => 2,
        'geocode' => is_array($decoded['geocode'] ?? null) ? $decoded['geocode'] : [],
        'search' => is_array($decoded['search'] ?? null) ? $decoded['search'] : [],
        'prices' => is_array($decoded['prices'] ?? null) ? $decoded['prices'] : [],
    ];
}

function persist_cache(array $cache): void
{
    @file_put_contents(
        CACHE_FILE,
        json_encode($cache, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        LOCK_EX
    );
}

function send_no_cache_headers(): void
{
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    header('Expires: 0');
}

function send_json(int $statusCode, array $payload): void
{
    http_response_code($statusCode);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

final class ApiException extends RuntimeException
{
    public int $statusCode;

    public function __construct(int $statusCode, string $message)
    {
        parent::__construct($message);
        $this->statusCode = $statusCode;
    }
}
