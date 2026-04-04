import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AiStyleService } from './ai-style.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('v1/ai-style')
@UseGuards(JwtAuthGuard)
export class AiStyleController {
  constructor(private readonly aiStyleService: AiStyleService) {}

  @Post('analyze')
  @UseInterceptors(FileInterceptor('photo'))
  analyze(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const consentGiven = req.body?.consentGiven === 'true' || req.body?.consentGiven === true;
    return this.aiStyleService.analyze(req.user.id, file, consentGiven);
  }

  @Get('history')
  getHistory(@Request() req: any) {
    return this.aiStyleService.getHistory(req.user.id);
  }

  @Delete(':id')
  deleteAnalysis(@Request() req: any, @Param('id') id: string) {
    return this.aiStyleService.deleteAnalysis(req.user.id, id);
  }

  @Post(':analysisId/preview')
  generatePreview(@Request() req: any, @Param('analysisId') analysisId: string) {
    return this.aiStyleService.generatePreview(req.user.id, analysisId);
  }
}
