@echo off
echo ========================================
echo   Развертывание аудио-конференции
echo ========================================
echo.

echo Выберите платформу для развертывания:
echo 1. Heroku
echo 2. Vercel
echo 3. Railway
echo 4. Выход
echo.

set /p choice="Введите номер (1-4): "

if "%choice%"=="1" goto heroku
if "%choice%"=="2" goto vercel
if "%choice%"=="3" goto railway
if "%choice%"=="4" goto exit
goto invalid

:heroku
echo.
echo Развертывание на Heroku...
echo.
echo 1. Убедитесь, что установлен Heroku CLI
echo 2. Выполните: heroku login
echo 3. Выполните: heroku create your-app-name
echo 4. Выполните: git init
echo 5. Выполните: git add .
echo 6. Выполните: git commit -m "Deploy"
echo 7. Выполните: git push heroku main
echo.
echo После развертывания ваше приложение будет доступно по адресу:
echo https://your-app-name.herokuapp.com
goto end

:vercel
echo.
echo Развертывание на Vercel...
echo.
echo 1. Установите Vercel CLI: npm install -g vercel
echo 2. Выполните: vercel
echo 3. Следуйте инструкциям в терминале
echo.
echo После развертывания ваше приложение будет доступно по адресу:
echo https://your-app-name.vercel.app
goto end

:railway
echo.
echo Развертывание на Railway...
echo.
echo 1. Зарегистрируйтесь на https://railway.app
echo 2. Создайте новый проект
echo 3. Подключите GitHub репозиторий
echo 4. Выберите папку с проектом
echo 5. Railway автоматически развернет приложение
echo.
goto end

:invalid
echo.
echo Неверный выбор! Попробуйте снова.
echo.
goto start

:exit
echo.
echo До свидания!
goto end

:end
echo.
echo ========================================
echo   Развертывание завершено!
echo ========================================
echo.
echo Подробные инструкции смотрите в файле DEPLOYMENT.md
echo.
pause
