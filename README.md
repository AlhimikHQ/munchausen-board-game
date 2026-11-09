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

Проверьте, что выбран проект `board-games-n1`. Добавление файлов в GitHub **не публикует** правила и Cloud Functions в Firebase автоматически. Для развёртывания Cloud Functions проекту потребуется тариф Firebase Blaze с подключённым платёжным аккаунтом; scheduled cleanup не начнёт работать, пока функцию не развернут. Правила базы (`--only database`) публикуются и на бесплатном тарифе; их можно также целиком вставить в Firebase Console → Realtime Database → Rules → Publish. Автоудаление комнаты при выходе создателя работает без Cloud Functions.

### Модель комнат и доступа

Код комнаты состоит из трёх кубиков (216 возможных комбинаций), поэтому это короткий идентификатор для поиска комнаты, а не пароль или секрет. Аутентифицированный пользователь может читать только метаданные, необходимые для проверки кода. Чтение участников, настроек, состояния, событий и запросов разрешено участникам комнаты и её создателю.

Места выделяются транзакцией в `slots/{seat}`. Запрос хода привязан к UID активного игрока и текущему `turnToken`. Только создатель комнаты публикует авторитетное состояние и события; клиентские запросы не могут напрямую записать `state` или `events`. Хост-клиент проверяет структуру и верхнюю грань броска; расхождение с его локальной физикой только пишется в консоль (на разных движках JS `Math.sin/cos` могут отличаться в последнем бите, а физика кубика хаотична, поэтому строгое сравнение отбрасывало бы честные броски). Это не серверный античит против злонамеренного участника/создателя: для такой модели доверия потребуется Cloud Functions или отдельный доверенный сервер.

Комната живёт, пока подключён её создатель. При создании хост регистрирует на сервере `onDisconnect().remove()` для всей комнаты: когда он выходит (кнопка выхода, закрытие вкладки или приложения, потеря связи), Firebase сразу удаляет комнату, а остальные игроки видят сообщение «Создатель вышел — комната закрыта» (в начатой игре страница после этого перезагружается). Присутствие обновляется каждые 30 секунд. Обычные участники при обрыве связи помечаются отключёнными через `onDisconnect`: в лобби их место освобождается через 2 минуты, в начатой игре они могут вернуться на своё место по коду комнаты. Подписки снимаются при выходе, пропущенные события после переподключения восстанавливаются из серверного snapshot.

Серверная функция раз в 15 минут служит страховкой: удаляет комнаты без создателя в списке участников или с отключённым создателем через 5 минут, комнаты с устаревшим heartbeat через 30 минут и закрытые комнаты через час.

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
