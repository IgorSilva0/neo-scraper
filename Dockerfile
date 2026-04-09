FROM lwthiker/curl-impersonate:0.5-chrome

RUN apt-get update && apt-get install -y nodejs npm

WORKDIR /app
COPY package.json .
RUN npm install
COPY index.js .

EXPOSE 3001
CMD ["node", "index.js"]