#!/system/bin/sh

ui_print "- Создание рабочей директории..."
mkdir -p /data/adb/sing-box

ui_print "- Настройка прав доступа..."
# Права на бинарник
chmod 0755 "$MODPATH/sing-box"

# Права на скрипты и WebUI
set_perm_recursive "$MODPATH/webroot" 0 0 0755 0755
set_perm "$MODPATH/action.sh" 0 0 0755
set_perm "$MODPATH/service.sh" 0 0 0755

ui_print "- Установка успешно завершена!"
ui_print "- Откройте карточку модуля для управления."