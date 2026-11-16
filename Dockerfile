FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html styles.css app.js manifest.webmanifest service-worker.js icon.svg icon-192.png icon-512.png /usr/share/nginx/html/

EXPOSE 80
