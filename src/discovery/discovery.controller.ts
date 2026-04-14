import { Controller, Get, Query } from '@nestjs/common';
import { DiscoveryService } from './discovery.service';
import { ExternalBarbersService } from './external-barbers.service';
import { SearchQueryDto, ViewportQueryDto } from './dto/search-query.dto';

@Controller('v1/discovery')
export class DiscoveryController {
  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly externalService: ExternalBarbersService,
  ) {}

  @Get('search')
  async search(@Query() query: SearchQueryDto) {
    const [internal, external] = await Promise.all([
      this.discoveryService.search(query),
      this.externalService.search(
        query.lat != null ? Number(query.lat) : undefined,
        query.lng != null ? Number(query.lng) : undefined,
        query.radius != null ? Number(query.radius) : undefined,
      ),
    ]);
    return [...internal, ...external];
  }

  @Get('external')
  external(
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('radius') radiusParam?: string,
  ) {
    return this.externalService.search(
      lat ? Number(lat) : undefined,
      lng ? Number(lng) : undefined,
      radiusParam ? Number(radiusParam) : undefined,
    );
  }

  @Get('viewport')
  viewport(@Query() query: ViewportQueryDto) {
    return this.discoveryService.viewport(query);
  }
}
