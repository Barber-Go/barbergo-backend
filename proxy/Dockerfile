FROM ubuntu:22.04

RUN apt-get update && \
    apt-get install -y squid apache2-utils && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create password file with basic auth credentials
RUN htpasswd -cb /etc/squid/passwd barbergo 'BarberGo2026!'

# Copy custom squid config
COPY squid.conf /etc/squid/squid.conf

# Squid listens on 3128
EXPOSE 3128

# Run squid in foreground
CMD ["squid", "-N", "-f", "/etc/squid/squid.conf"]
