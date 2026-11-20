# Аренда сервера с видеокартой для VR Workspace

Подборка от 2026-11-20. Цены взяты из сторонних сводок с разными датами, без НДС. Перед заказом сверить на сайте
компании.

## Что нужно от сервера

- Своя система (выделенный сервер или полноценная виртуальная машина), чтобы поставить Ubuntu с GNOME 46 на Wayland.
  Дешёвые почасовые «GPU-облака» дают только контейнер, а в нём GNOME не запустится.
- Графика AMD или Intel: тогда сжатие видео работает как есть (тот же способ, что у AMD 780M дома). С NVIDIA
  нужна доработка под её кодировщик (мониторы и окна).
- Близко к вам: при пинге выше ~30 мс указатель мыши заметно отстаёт.

## Топ-3

| | Что это | Графика | Цена (без НДС) | Подойдёт ли код |
|---|---|---|---|---|
| **1. Hetzner EX44** | выделенный сервер, Германия или Финляндия | встроенная Intel UHD 770 (процессор i5-13500) | около €52–59 в месяц; в некоторых сводках ещё €46 за подключение | как есть |
| **2. Hetzner AX42** | выделенный сервер, Германия или Финляндия | встроенная Radeon 780M, ровно как дома | €97–99 в месяц + €49 за подключение | как есть |
| **3. HOSTKEY, GPU VPS** | виртуальная машина с отдельной картой, Нидерланды | NVIDIA GTX 1080 Ti | €70 в месяц (предзаказ); выделенный сервер с ней ~$185 | нужна доработка под NVIDIA |

**Выбор: Hetzner EX44 в Финляндии (Хельсинки).** Самый дешёвый вариант, код почти наверняка заработает без
переделок, а до Восточной Европы ближе, чем из Германии. AX42 — если нужно точно то же железо, что дома, но он почти
вдвое дороже.

Есть вариант серьёзнее, но дороже: **Hetzner GEX44** (NVIDIA RTX 4000 SFF Ada) — €184–234 в месяц и €79–114 за
подключение.

## Проверить перед заказом

- **Включена ли встроенная графика.** У выделенных серверов нет монитора, встроенную графику иногда отключают. Для
  серверов Hetzner на Intel есть инструкция, как её включить ([enable_igpu_on_hetzner](https://github.com/desimaniac/docs/blob/master/enable_igpu_on_hetzner.md)).
  Про AX42 подтверждения не нашлось: спросить поддержку Hetzner до заказа — «is the integrated GPU (/dev/dri)
  available on AX42?». На сервере проверить командами `ls /dev/dri` и `vainfo`.
- **Итоговая цена.** Летом 2026 Hetzner менял цены, источники расходятся. Плюс НДС, плюс у Hetzner отдельно
  оплачивается внешний IPv4-адрес.
- **Трафик.** Из дата-центров он иногда оплачивается отдельно. Неподвижный экран теперь стоит мало (около 0,7 Мбит/с на
  монитор), меняющийся — до 20.

## Что доделать в VR Workspace для удалённого сервера

1. **Клавиатура и мышь с телефона — главное.** У сервера своих нет; сейчас с телефона управляются только отдельные
   окна, и только мышью. Нужны клавиатура и мышь, подключённые к телефону по Bluetooth, и их передача на все мониторы.
2. **Для NVIDIA** — другой кодировщик в `capture.py` и `windows.py`.
3. **Настройка сервера:** GNOME 46 на Wayland с автоматическим входом без монитора, звуковой сервер PipeWire (без него
   захват мониторов не запускается), выключенная блокировка экрана. Для физического сервера проще всего заглушка HDMI,
   которая притворяется монитором.
4. **Сеть:** открыть в брандмауэре сервера 8443 (TCP) и 8189 (UDP и TCP), вписать адрес во вкладку «Remote». Безопаснее
   через VPN (например, WireGuard): тогда в интернет ничего не открыто.

## Источники

- [Hetzner AX42](https://www.hetzner.com/dedicated-rootserver/ax42/)
- [AX42 pricing PR (agentdeals)](https://github.com/robhunter/agentdeals/pull/2259)
- [CI Runner Price Comparison 2026](https://craci.com/ci-runner-pricing)
- [Hetzner EX44 — hostometer](https://hostometer.net/en/dedicated-server/134-Hetzner-EX44)
- [Dedicated vs VPS: 757 plans (DEV Community)](https://dev.to/hostingsift/when-a-dedicated-server-gets-cheaper-than-a-vps-757-plans-priced-by-ram-2026-58if)
- [EX44 — hosting.gallery](https://hosting.gallery/companies/hetzner-com/dedicated-servers/ex44-de)
- [Enable iGPU on Hetzner (GitHub)](https://github.com/desimaniac/docs/blob/master/enable_igpu_on_hetzner.md)
- [HOSTKEY cheap GPU servers](https://hostkey.com/dedicated-servers/cheap-gpu/)
- [HOSTKEY GPU VPS](https://hostkey.com/dedicated-servers/gpu-vps/)
- [Hetzner GEX44 tariff — GPUDeck](https://gpudeck.com/providers/hetzner/)
- [Hetzner RTX PRO 6000 / GEX44 cost — bex.co](https://bex.co/blog/2026/08/16/hetzner-rtx-pro-6000-blackwell-self-hosting-ai-inference-cost)
- [GPU VPS for Rendering & VDI 2026 — Hostline](https://hostline.io/blog/gpu-vps-rendering-vdi-compared-2026/)
