# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/OpenGym.Nutrition/OpenGym.Nutrition.csproj ./
# Optional session CA for builds behind a TLS proxy; ordinary builds use system trust.
RUN --mount=type=secret,id=proxy_ca,target=/run/proxy-ca-bundle \
    if [ -f /run/proxy-ca-bundle ]; then export SSL_CERT_FILE=/run/proxy-ca-bundle; fi; \
    dotnet restore OpenGym.Nutrition.csproj
COPY src/OpenGym.Nutrition/ ./
RUN dotnet publish OpenGym.Nutrition.csproj -c Release --no-restore -o /out /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0
ARG VERSION=dev
ARG VCS_REF=dev
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.title="opengym-nutrition" \
      org.opencontainers.image.description="ASP.NET Core Nutrition API for openGym" \
      org.opencontainers.image.source="https://github.com/illya228666/openGym" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.version=$VERSION \
      org.opencontainers.image.revision=$VCS_REF \
      org.opencontainers.image.created=$BUILD_DATE
WORKDIR /app
COPY --from=build /out ./
ENV ASPNETCORE_HTTP_PORTS=8080
ENV Nutrition__DatabasePath=/data/nutrition.db
RUN mkdir /data && chown $APP_UID:$APP_UID /data
USER $APP_UID
ENTRYPOINT ["dotnet", "OpenGym.Nutrition.dll"]
