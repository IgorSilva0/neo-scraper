FROM lwthiker/curl-impersonate:0.5-chrome

RUN apk add --no-cache nodejs npm

WORKDIR /app
COPY package.json .
RUN npm install
COPY index.js .

EXPOSE 3001
CMD ["node", "index.js"]