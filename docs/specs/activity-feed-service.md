Create a pure NestJS microservice named ActivityFeedService.

Requirements:

- Bootstrap it with NestFactory.createMicroservice().
- Use RabbitMQ through @nestjs/microservices.
- Do not start an HTTP server.
- Do not use app.connectMicroservice().
- Persist activity-feed entries in MongoDB.
- Consume routine.created using @EventPattern('routine.created').
- Handle feed queries using
  @MessagePattern('activity-feed.get-by-user').

The main API must:

- Publish routine.created using ClientProxy.emit().
- Expose GET /api/v1/activity-feed.
- Obtain feed entries from ActivityFeedService using
  ClientProxy.send('activity-feed.get-by-user', ...).
- Derive userId from the authenticated user rather than accepting an
  arbitrary userId query parameter.

## Architecture

Client
  ↓ HTTP
Main API
  ├── POST /routines
  ├── GET /activity-feed
  │
  ├── publishes routine.created
  │            ↓
  │        RabbitMQ
  │            ↓
  │   Activity Feed Microservice
  │            ↓
  │         MongoDB
  │
  └── reads feed data from Activity Feed service

## Usefull Documentation
- https://docs.nestjs.com/microservices/basics
- https://docs.nestjs.com/microservices/rabbitmq