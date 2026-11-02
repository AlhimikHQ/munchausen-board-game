# Мюнхгаузен — настольная игра (Web и Android)

Игра реализована в одной странице: `docs/index.html`. Android-приложение загружает ту же страницу через `WebViewAssetLoader` с локального HTTPS-origin.

## Структура

- `docs/index.html` — игровой интерфейс, физика кубика и сетевой клиент.
- `database.rules.json` — правила доступа Firebase Realtime Database.
- `firebase.json`, `.firebaserc` — конфигурация Firebase CLI, Realtime Database и Cloud Functions.
- `functions/` — плановая серверная очистка брошенных комнат.
- `tests/` — статические тесты протокола, правил Firebase и TTL-очистки.
- `android/` — Android WebView-оболочка.
- `.github/workflows/android.yml` — тестирование перед сборкой APK.

## Firebase: первоначальная настройка

Проект использует Firebase Realtime Database в регионе `europe-west1` и анонимную аутентификацию. В Firebase Console необходимо включить **Authentication → Sign-in method → Anonymous**.

Firebase Web API key в HTML является идентификатором публичного клиента, а не секретом. Защита данных обеспечивается Realtime Database Security Rules. Не заменяйте правила на открытые `.read: true` / `.write: true`.

Перед публикацией правил и серверной очистки выполните из корня репозитория:

```bash
npm install
npm --prefix functions install
npx firebase login
npx firebase deploy --only database,functions --project board-games-n1
```

Проверьте, что выбран проект `board-games-n1`. Добавление файлов в GitHub **не публикует** правила и Cloud Functions в Firebase автоматически. Для развёртывания Cloud Functions проекту потребуется тариф Firebase Blaze с подключённым платёжным аккаунтом; scheduled cleanup не начнёт работать, пока функцию не развернут.

### Модель комнат и доступа

Код комнаты состоит из трёх кубиков (216 возможных комбинаций), поэтому это короткий идентификатор для поиска комнаты, а не пароль или секрет. Аутентифицированный пользователь может читать только метаданные, необходимые для проверки кода. Чтение участников, настроек, состояния, событий и запросов разрешено участникам комнаты и её создателю.

Места выделяются транзакцией в `slots/{seat}`. Запрос хода привязан к UID активного игрока и текущему `turnToken`. Только создатель комнаты публикует авторитетное состояние и события; клиентские запросы не могут напрямую записать `state` или `events`. Проверка физического броска в хост-клиенте снижает риск случайной подмены, но не является серверным античитом против злонамеренного участника/создателя: для такой модели доверия потребуется Cloud Functions или отдельный доверенный сервер.

При потере соединения участник помечается отключённым через `onDisconnect`, а живой клиент обновляет presence heartbeat раз в минуту. Комната не удаляется при временном отключении хоста: его сессия и последний snapshot сохраняются для переподключения. При ручном выходе хост удаляет комнату; отключившиеся участники лобби удаляются после 15 минут, а серверная функция раз в час удаляет комнаты с отключённым хостом после 24 часов, закрытые комнаты после часа и неактивные комнаты после семи суток. Подписки снимаются при выходе, пропущенные события после переподключения восстанавливаются из серверного snapshot.

## Тесты

Требуются Node.js 24.12+ и JDK 21 для Firebase Emulator. Для Android APK используется JDK 17 и Gradle 8.7.

```bash
npm install
npm run test:static
npm run test:rules
npm run test:cleanup
# все проверки:
npm test
```

`test:rules` запускает локальный Firebase Realtime Database Emulator и проверяет запреты на чтение чужого игрового состояния, запись чужого хода, изменение чужого участника и конкурентное выделение одного места двум клиентам. `test:cleanup` проверяет политику срока жизни комнат и синтаксис Cloud Function.

## Android APK

GitHub Actions runs the tests and builds an optimized release APK. No GitHub Secrets or manual key setup is required.

The repository contains one fixed **public debug signature** in `android/munchausen-debug.keystore.base64`. It is only an Android app identity used to allow updates to install over the previous version; it is not a security secret. Every build uses the same signature.

The release build enables R8 code shrinking and resource shrinking. The CI run number is used for an increasing Android `versionCode`. The APK is uploaded as the `munchausen-apk` artifact.

**One-time migration:** Android cannot install an APK over an existing app when the signing certificate differs. Since older builds used temporary CI debug signatures, the first install of this fixed-signature build may require uninstalling the old app once. After that, new APKs update in place.

Local single-player mode does not load Firebase. The Firebase SDK is loaded only when the network-game panel is opened. Multiplayer turn locks transact only on the small `state` node; state and event changes are sent together in one database update.

Android: minSdk 26 (Android 8), compileSdk 34, JDK 17, Android Gradle Plugin 8.5.2, Gradle 8.7.

## Веб-версия

Для GitHub Pages выберите **Settings → Pages → Deploy from a branch → main → /docs**.
