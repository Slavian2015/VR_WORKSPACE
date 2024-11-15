FROM node:18

RUN mkdir -p /client
WORKDIR /client

COPY package.json ./
COPY package-lock.json ./
RUN npm install

EXPOSE 8082
# CMD ["npm", "start"]