FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
COPY src ./src
RUN --mount=type=cache,target=/root/.m2 mvn -B -DskipTests package

FROM eclipse-temurin:21-jre-alpine
RUN addgroup -S filetrail && adduser -S filetrail -G filetrail && mkdir /data && chown filetrail:filetrail /data
WORKDIR /app
COPY --from=build /src/target/filetrail-0.1.0.jar app.jar
USER filetrail
ENV DATA_DIR=/data/objects
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=70", "-jar", "/app/app.jar"]
