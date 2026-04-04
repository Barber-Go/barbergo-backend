import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

// Face shape → recommended haircuts mapping
const HAIRCUT_CATALOG: Record<string, { name: string; rationale: string; score: number; tags: string[] }[]> = {
  oval: [
    { name: 'Fade Clásico', rationale: 'La forma oval es la más versátil. El fade clásico resalta la simetría natural de tu rostro.', score: 0.95, tags: ['fade', 'clásico', 'versátil'] },
    { name: 'Pompadour', rationale: 'Añade volumen arriba sin desequilibrar las proporciones. Ideal para rostro oval.', score: 0.90, tags: ['pompadour', 'volumen', 'elegante'] },
    { name: 'Buzz Cut', rationale: 'Con un rostro oval, incluso un corte muy corto se ve proporcional y limpio.', score: 0.85, tags: ['buzz', 'corto', 'bajo mantenimiento'] },
    { name: 'Textured Crop', rationale: 'La textura arriba complementa la armonía del rostro oval.', score: 0.88, tags: ['textura', 'moderno', 'casual'] },
  ],
  redondo: [
    { name: 'High Fade con Volumen', rationale: 'El fade alto estiliza el rostro redondo al alargar visualmente la cara.', score: 0.93, tags: ['fade', 'alto', 'estilizante'] },
    { name: 'Quiff', rationale: 'El volumen en la parte superior añade longitud visual al rostro redondo.', score: 0.90, tags: ['quiff', 'volumen', 'moderno'] },
    { name: 'Side Part', rationale: 'La raya lateral crea líneas angulares que contrastan con la redondez.', score: 0.87, tags: ['side part', 'formal', 'angular'] },
    { name: 'Pompadour Alto', rationale: 'Elonga significativamente el rostro. Perfecto para caras redondas.', score: 0.91, tags: ['pompadour', 'alto', 'impactante'] },
  ],
  cuadrado: [
    { name: 'Crew Cut', rationale: 'Limpio y estructurado, complementa la mandíbula marcada.', score: 0.92, tags: ['crew', 'corto', 'masculino'] },
    { name: 'Fade con Textura', rationale: 'Suaviza ligeramente los ángulos manteniendo un look definido.', score: 0.90, tags: ['fade', 'textura', 'equilibrado'] },
    { name: 'Slick Back', rationale: 'Peinado hacia atrás resalta la estructura fuerte del rostro cuadrado.', score: 0.88, tags: ['slick', 'peinado', 'clásico'] },
    { name: 'French Crop', rationale: 'El flequillo corto suaviza la frente amplia del rostro cuadrado.', score: 0.86, tags: ['french', 'crop', 'europeo'] },
  ],
  alargado: [
    { name: 'Fringe / Flequillo', rationale: 'Acorta visualmente el rostro cubriendo parte de la frente.', score: 0.94, tags: ['fringe', 'flequillo', 'equilibrante'] },
    { name: 'Side Swept', rationale: 'Añade anchura visual y reduce la percepción de longitud.', score: 0.89, tags: ['lateral', 'volumen', 'suave'] },
    { name: 'Messy Crop', rationale: 'La textura desordenada distrae de la longitud del rostro.', score: 0.87, tags: ['messy', 'textura', 'casual'] },
    { name: 'Curtain Bangs', rationale: 'Divide la longitud facial con un look relajado y moderno.', score: 0.85, tags: ['curtain', 'moderno', 'relajado'] },
  ],
  diamante: [
    { name: 'Side Part Largo', rationale: 'El largo lateral rellena las sienes estrechas del rostro diamante.', score: 0.91, tags: ['side part', 'largo', 'elegante'] },
    { name: 'Textured Fringe', rationale: 'Cubre la frente estrecha mientras añade anchura visual.', score: 0.89, tags: ['textura', 'fringe', 'moderno'] },
    { name: 'Mid Fade con Largo Arriba', rationale: 'El contraste suaviza los pómulos prominentes.', score: 0.87, tags: ['fade', 'medio', 'balanced'] },
  ],
  corazon: [
    { name: 'Medium Length Swept', rationale: 'El largo medio balancea la frente ancha con el mentón estrecho.', score: 0.92, tags: ['medio', 'peinado', 'balanceado'] },
    { name: 'Fringe Lateral', rationale: 'El flequillo lateral suaviza la frente ancha.', score: 0.90, tags: ['fringe', 'lateral', 'suavizante'] },
    { name: 'Textured Crop Corto', rationale: 'Textura arriba sin demasiado volumen que agrande la parte superior.', score: 0.86, tags: ['textura', 'corto', 'proporcional'] },
  ],
};

@Injectable()
export class AiStyleService {
  private anthropic: Anthropic;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {
    this.anthropic = new Anthropic({
      apiKey: this.config.get<string>('ANTHROPIC_API_KEY'),
    });
  }

  // ── Analyze face shape ────────────────────────────────────────────────────

  async analyze(userId: string, file: Express.Multer.File, consentGiven: boolean) {
    if (!consentGiven) {
      throw new BadRequestException('Debes aceptar el consentimiento para analizar tu foto');
    }
    if (!file || !file.buffer) {
      throw new BadRequestException('Debes subir una foto');
    }

    // Upload to Cloudinary
    const imageUrl = await this.storage.uploadImage(file, 'ai-style');

    // Call Claude API for face shape analysis
    const base64 = file.buffer.toString('base64');
    const mediaType = file.mimetype as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

    let faceShape = 'oval';
    let confidence = 0.8;
    let attributes: Record<string, any> = {};

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64 },
              },
              {
                type: 'text',
                text: `Analiza la forma del rostro en esta foto. NO identifiques a la persona.
Solo determina atributos visuales de la forma del rostro.

Responde SOLO con JSON válido, sin markdown:
{
  "faceShape": "oval|redondo|cuadrado|alargado|diamante|corazon",
  "confidence": 0.0-1.0,
  "attributes": {
    "jawline": "angulada|suave|marcada|estrecha",
    "forehead": "ancha|media|estrecha",
    "cheekbones": "prominentes|medios|sutiles"
  }
}`,
              },
            ],
          },
        ],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const parsed = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
      faceShape = parsed.faceShape || 'oval';
      confidence = parsed.confidence || 0.8;
      attributes = parsed.attributes || {};
    } catch (err) {
      // Fallback to oval if API fails
      console.error('Claude API error:', err);
    }

    // Save analysis
    const analysis = await this.prisma.client.aiFaceAnalysis.create({
      data: {
        userId,
        sourceImageUrl: imageUrl,
        faceShape,
        confidence,
        attributesJson: attributes,
      },
    });

    // Generate recommendations from catalog
    const catalogRecs = HAIRCUT_CATALOG[faceShape] ?? HAIRCUT_CATALOG['oval'];
    const recommendations = await Promise.all(
      catalogRecs.map((rec) =>
        this.prisma.client.aiHairstyleRecommendation.create({
          data: {
            analysisId: analysis.id,
            haircutName: rec.name,
            rationale: rec.rationale,
            score: rec.score,
            tags: rec.tags,
          },
        }),
      ),
    );

    return {
      id: analysis.id,
      faceShape: analysis.faceShape,
      confidence: analysis.confidence,
      attributes,
      sourceImageUrl: analysis.sourceImageUrl,
      recommendations: recommendations.map((r) => ({
        id: r.id,
        haircutName: r.haircutName,
        rationale: r.rationale,
        score: r.score,
        tags: r.tags,
      })),
      createdAt: analysis.createdAt,
    };
  }

  // ── History ───────────────────────────────────────────────────────────────

  async getHistory(userId: string) {
    const analyses = await this.prisma.client.aiFaceAnalysis.findMany({
      where: { userId },
      include: {
        recommendations: {
          orderBy: { score: 'desc' },
          select: { id: true, haircutName: true, rationale: true, score: true, tags: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return analyses.map((a) => ({
      id: a.id,
      faceShape: a.faceShape,
      confidence: a.confidence,
      sourceImageUrl: a.sourceImageUrl,
      recommendations: a.recommendations,
      createdAt: a.createdAt,
    }));
  }

  // ── Delete analysis ───────────────────────────────────────────────────────

  async deleteAnalysis(userId: string, analysisId: string) {
    const analysis = await this.prisma.client.aiFaceAnalysis.findUnique({
      where: { id: analysisId },
    });
    if (!analysis) throw new NotFoundException('Análisis no encontrado');
    if (analysis.userId !== userId) throw new ForbiddenException();

    // Delete from Cloudinary
    try {
      const url = analysis.sourceImageUrl;
      const match = url.match(/\/barbergo\/(.+)\.\w+$/);
      if (match) await this.storage.deleteImage(`barbergo/${match[1]}`);
    } catch { /* ignore */ }

    await this.prisma.client.aiFaceAnalysis.delete({ where: { id: analysisId } });
    return { message: 'Análisis eliminado' };
  }

  // ── Preview stub ──────────────────────────────────────────────────────────

  async generatePreview(userId: string, analysisId: string) {
    const analysis = await this.prisma.client.aiFaceAnalysis.findUnique({
      where: { id: analysisId },
      include: { recommendations: true },
    });
    if (!analysis) throw new NotFoundException('Análisis no encontrado');
    if (analysis.userId !== userId) throw new ForbiddenException();

    // Create preview stubs for all recommendations
    const previews = await Promise.all(
      analysis.recommendations.map((rec) =>
        this.prisma.client.aiHairstylePreview.create({
          data: {
            recommendationId: rec.id,
            generationStatus: 'PENDING',
          },
        }),
      ),
    );

    return {
      message: 'Generación de previews en cola',
      previews: previews.map((p) => ({
        id: p.id,
        recommendationId: p.recommendationId,
        status: p.generationStatus,
      })),
    };
  }
}
