#!/system/bin/sh

# Пути к данным
MOD_DIR="/data/adb/sing-box"
LOG_FILE="$MOD_DIR/run.log"
PID_FILE="$MOD_DIR/run.pid"
BIN_PATH="/data/adb/modules/singbox_ksu/sing-box"

# 1. Жестко убиваем процесс, если он еще запущен
pkill -9 -f "$BIN_PATH"

# 2. Удаляем временные файлы работы (логи и PID)
if [ -f "$LOG_FILE" ]; then
    rm -f "$LOG_FILE"
fi

if [ -f "$PID_FILE" ]; then
    rm -f "$PID_FILE"
fi

# 3. Удаление основной папки с конфигами
# ВНИМАНИЕ: Это удалит все ваши конфиги и Geo-базы. 
# Если вы хотите оставить их при переустановке модуля, закомментируйте строку ниже.
rm -rf "$MOD_DIR"

# 4. Удаление возможных временных файлов в /tmp или /dev (если sing-box их создавал)
rm -rf /dev/sing-box 2>/dev/null

exit 0