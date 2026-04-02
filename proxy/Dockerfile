FROM ubuntu:22.04

RUN apt-get update && \
    apt-get install -y squid && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY squid.conf /etc/squid/squid.conf

RUN mkdir -p /var/spool/squid /var/log/squid /var/run/squid && \
    chown -R proxy:proxy /var/spool/squid /var/log/squid /var/run/squid

EXPOSE 3128

CMD ["squid", "-N", "-f", "/etc/squid/squid.conf"]
