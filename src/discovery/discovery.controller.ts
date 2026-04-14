import { Controller, Get, Query } from '@nestjs/common';
import { DiscoveryService } from './discovery.service';
import { SearchQueryDto, ViewportQueryDto } from './dto/search-query.dto';

@Controller('v1/discovery')
export class DiscoveryController {
  constructor(private readonly discoveryService: DiscoveryService) {}

  @Get('search')
  search(@Query() query: SearchQueryDto) {
    return this.discoveryService.search(query);
  }

  @Get('viewport')
  viewport(@Query() query: ViewportQueryDto) {
    return this.discoveryService.viewport(query);
  }
}
