# syntax=docker/dockerfile:1.7
FROM maven:3.9.11-eclipse-temurin-21 AS build
WORKDIR /workspace
COPY backend/pom.xml backend/pom.xml
COPY db/migrations db/migrations
COPY docs/design/openapi/order-show-api.yaml docs/design/openapi/order-show-api.yaml
COPY backend/src backend/src
ARG SKIP_TESTS=true
RUN --mount=type=cache,target=/root/.m2 mvn -f backend/pom.xml -DskipTests=${SKIP_TESTS} package

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd --system --uid 10001 ordershow
COPY --from=build /workspace/backend/target/order-show-backend-0.1.0.jar app.jar
USER ordershow
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
