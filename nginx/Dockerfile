FROM nginx:1.27-alpine
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/
COPY .htpasswd /etc/nginx/.htpasswd
COPY portal/ /usr/share/nginx/html/portal/
COPY sso/ /usr/share/nginx/html/__sso/
