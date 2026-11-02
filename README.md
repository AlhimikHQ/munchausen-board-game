# Мюнхгаузен — настольная игра (Web + Android)

Единый игровой клиент находится в `docs/index.html`. Он используется GitHub Pages и Android WebView.

## Структура проекта

- `docs/index.html` — игровая логика, аудио, интерфейс и Firebase-клиент.
- `database.rules.json` — правила доступа Realtime Database.
- `functions/index.js` — плановая очистка устаревших комнат и заявок.
- `firebase.json`, `.firebaserc` — конфигурация Firebase CLI.
- `test/` — статические проверки и тесты Security Rules через Emulator Suite.
- `.github/workflows/android.yml` — проверки Firebase, Android lint и сборка APK.

## Firebase

Проект по умолчанию в `.firebaserc` — `board-games-n1`. Конфигурация клиента расположена в начале Firebase-блока в `docs/index.html`. При необходимости её можно переопределить до инициализации Firebase через `window.MUNCHAUSEN_FIREBASE_CONFIG`.

Для сетевой игры включите в Firebase Authentication анонимный вход и проверьте, что Realtime Database создана в том же проекте и регионе, который указан в конфигурации клиента.

Комнаты используют трёхкубиковый код только как короткий идентификатор, а не как пароль. Запрос на вход создаётся от анонимного Firebase UID и подтверждается ведущим. До подтверждения игрок не читает содержимое комнаты. В правилах чтение разделено по веткам: игровые данные доступны участникам, очередь ходов — ведущему, заявка — её автору и ведущему.

Перед публикацией новой версии правил и функции очистки выполните из корня репозитория:

```bash
npm install
npm test
firebase login
firebase use board-games-n1
firebase deploy --only database,functions
```

Проверьте, что выбран правильный Firebase-проект, прежде чем выполнять deploy. Автоматическая очистка удаляет закрытые комнаты после периода хранения, комнаты с отключённым более 24 часов ведущим и заявки на вход старше 10 минут. Повторное использование короткого кода также проверяется правилами создания комнаты.

## Проверки и сборка

Требования локального запуска: Node.js 22, Java 17 и Gradle 8.7.

```bash
npm install
npm run test:static
npm run test:rules
npm test

cd android
gradle --no-daemon testDebugUnitTest lintDebug assembleDebug
```

GitHub Actions выполняет те же тесты Realtime Database Emulator перед Android lint и APK build. Артефакт называется `munchausen-apk`; внутри — `app-debug.apk`.

Версия Android-приложения сейчас `1.2` (`versionCode 3`). Перед очередным релизом увеличивайте `versionCode`.

## GitHub Pages

В настройках репозитория откройте **Settings → Pages → Deploy from a branch**, выберите `main` и папку `/docs`.

## Ограничения короткого кода

Всего существует 216 кодов из трёх кубиков. Это не секрет и его можно перебирать. Безопасность комнаты обеспечивается не сложностью кода, а Firebase Authentication, приватными правилами чтения и ручным одобрением заявки ведущим. Для масштабирования за пределы небольших приватных партий потребуется более длинный случайный invite token и серверное ограничение частоты заявок.
