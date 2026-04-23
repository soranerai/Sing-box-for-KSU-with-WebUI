#!/system/bin/sh

MODDIR=${0%/*}
LIST_FILE="$MODDIR/autoupdate.list"
BIN_PATH="$MODDIR/sing-box"

# Функция для записи логов демона
log_msg() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$MODDIR/autoupdater.log"
}

log_msg "Запуск демона автообновления..."

while true; do
  now=$(date +%s)
  
  if [ -f "$LIST_FILE" ]; then
    while IFS="|" read -r file interval_hours url; do
      [ -z "$url" ] && continue
      [ -z "$interval_hours" ] && interval_hours=24
      
      target_file="$MODDIR/$file"
      
      # Если файла еще нет, считаем его время 0
      if [ ! -f "$target_file" ]; then
        last=0
      else
        last=$(stat -c %Y "$target_file")
      fi
      
      diff=$((now - last))
      int_sec=$((interval_hours * 3600))
      
      if [ $diff -ge $int_sec ]; then
        log_msg "Обновление конфигурации: $file"
        tmp_file="$MODDIR/.tmp_$file"
        
        # Скачиваем во временный файл
        busybox wget -q --no-check-certificate -O "$tmp_file" "$url"
        
        # Проверяем валидность конфига
        if $BIN_PATH check -c "$tmp_file" >/dev/null 2>&1; then
          mv -f "$tmp_file" "$target_file"
          log_msg "Успешно обновлено: $file"
        else
          rm -f "$tmp_file"
          log_msg "Ошибка: невалидный конфиг от $url"
        fi
      fi
    done < "$LIST_FILE"
  fi
  
  # Спим 5 минут перед следующей проверкой
  sleep 300
done
