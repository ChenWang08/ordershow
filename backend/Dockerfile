# syntax=docker/dockerfile:1.7
FROM maven:3.9.11-eclipse-temurin-21 AS build
WORKDIR /workspace
COPY backend/pom.xml backend/pom.xml
COPY db/migrations db/migrations
COPY docs/design/openapi/order-show-api.yaml docs/design/openapi/order-show-api.yaml
COPY backend/src backend/src
ARG SKIP_TESTS=true
# Optional related test classes for a focused release verification.
ARG TESTS
RUN --mount=type=cache,target=/root/.m2 \
    if [ -n "$TESTS" ]; then mvn -f backend/pom.xml -DskipTests=false "-Dtest=$TESTS" package; \
    else mvn -f backend/pom.xml -DskipTests=${SKIP_TESTS} package; fi

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd --system --uid 10001 ordershow
COPY --from=build /workspace/backend/target/order-show-backend-0.1.0.jar app.jar
USER ordershow
EXPOSE 8080
HEALTHCHECK --interval=3s --timeout=3s --start-period=45s --retries=20 CMD curl --fail --silent http://127.0.0.1:${SERVER_PORT:-8080}/api/v1/actuator/health/readiness > /dev/null || exit 1
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
