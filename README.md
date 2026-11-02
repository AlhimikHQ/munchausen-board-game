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

## Сборка APK и установка обновлений

GitHub Actions сначала выполняет статические и Firebase Rules Emulator-тесты. Для сборки распространяемого APK используется **release-подпись одним постоянным keystore**. Это обязательно для установки новой версии поверх старой: debug-сертификат GitHub runner меняется между изолированными CI-запусками.

### Одноразовая настройка подписи

Создайте ключ вне папки репозитория (например, в домашней директории Cloud Shell):

```bash
cd ~
keytool -genkeypair -v -keystore munchausen-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias munchausen-release
base64 -w 0 munchausen-release.jks
```

Сохраните пароль keystore и пароль ключа. Скопируйте выведенную base64-строку и добавьте в GitHub → **Settings → Secrets and variables → Actions** следующие Repository secrets:

- `ANDROID_KEYSTORE_BASE64` — base64-строка файла keystore;
- `ANDROID_KEYSTORE_PASSWORD` — пароль keystore;
- `ANDROID_KEY_ALIAS` — `munchausen-release`;
- `ANDROID_KEY_PASSWORD` — пароль ключа.

**Не добавляйте `munchausen-release.jks` в Git или в артефакты.** Потеря ключа лишит возможности выпускать обновления поверх уже установленных APK.

После настройки каждый запуск GitHub Actions на `main` собирает подписанный `app-release.apk` в артефакте `munchausen-apk`. `versionCode` автоматически увеличивается для каждого запуска CI.

### Важный момент при переходе с прежних APK

Старые APK собирались с временным debug-ключом. Android не разрешает обновлять приложение, если сертификат новой сборки отличается. Поэтому **один раз** потребуется удалить старую debug-сборку и установить первый APK, подписанный постоянным ключом. После этого все следующие версии будут устанавливаться поверх предыдущих без удаления приложения.

Параметры Android: minSdk 26 (Android 8), compileSdk 34, JDK 17, Android Gradle Plugin 8.5.2, Gradle 8.7.

## Веб-версия

Для GitHub Pages выберите **Settings → Pages → Deploy from a branch → main → /docs**.
