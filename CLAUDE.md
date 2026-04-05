# BarberGo Backend — Reglas del proyecto

## Uso obligatorio de agentes

SIEMPRE usar el agente especializado correspondiente para cada tarea:
- Cambios en schema Prisma o seeds → db-agent
- Módulos NestJS, endpoints, servicios → backend-agent
- Integración SII, boletas, tax compliance → sii-agent
- Tests y validaciones → qa-agent
- Arquitectura de nuevos bloques → architect

NUNCA hacer cambios directamente sin invocar el agente correspondiente.
El orden siempre es: architect → db-agent → backend-agent → qa-agent

## Stack
- NestJS + TypeScript + Prisma v7 + PostgreSQL
- Railway: barbergo-backend-production.up.railway.app/api/v1
- Puerto local: 3000

## Reglas absolutas
- NUNCA any en TypeScript
- NUNCA hardcodear credenciales
- NUNCA endpoints sin guard (excepto auth/)
- SIEMPRE validar DTOs con class-validator
- SIEMPRE formato respuesta: { data, message, statusCode }
- SIEMPRE guards de rol en endpoints protegidos

## Agentes disponibles
Los agentes están en ~/Desktop/barbergo-mobile/.claude/agents/
Leer el agente correspondiente antes de cada tarea.
