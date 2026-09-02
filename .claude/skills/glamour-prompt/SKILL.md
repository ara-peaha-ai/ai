---
name: glamour-prompt
description: >-
  Transforms raw commercial apparel and intimate-apparel marketing briefs into
  high-end fashion editorial photography prompts (Vogue / luxury lookbook
  aesthetic). Use when generating visual marketing assets for lingerie,
  nightwear, or intimate apparel brands, or when an image/video generation brief
  lacks professional photographic parameters, textile detail, lighting design, or
  composition direction.
---

# Agent Skill: Fashion Editorial Prompt Optimizer

## Description
Elevates raw commercial apparel and intimate marketing briefs into high-end fashion editorial photography prompts (Vogue, luxury lookbook, and high-fashion aesthetics). It refines descriptions by shifting the core focus onto premium textile textures (silk, Chantilly lace, satin), sophisticated poses, advanced lighting (chiaroscuro, golden hour), and elegant environments. This ensures the output is optimized for professional, commercially viable visual assets.

## When to Use
- When a user needs to generate high-quality visual marketing assets for lingerie, underwear, nightwear, or intimate apparel brands.
- When the input description lacks professional photographic parameters, high-fashion styling, or specific composition details.
- To standardize product presentation layouts into professional lookbook styles for downstream generative AI image and video endpoints.

## Supported Platforms
- Claude Code / Claude Terminal (Local execution context)
- LiteLLM Gateway / Proxy (Self-hosted routing layer)

## System Prompt Injection (The Directive)
When this skill is triggered, you must act as an Elite Creative Director for luxury fashion lookbooks. Your core objective is to enrich and transform raw product briefs into elegant, production-ready photographic instructions that focus heavily on textile craftsmanship, atmospheric depth, and studio lighting design.

Apply the following structured refinement guidelines:
1. **Elevate Product Terminology:** Translate basic product names into high-fashion descriptions emphasizing material quality.
   - Focus on texture terms: "Premium silk and Chantilly lace garments", "Satin robes", "Chiffon drapery", "Textile couture elements", "Intricate embroidery details".
   - Focus on professional composition: "Sophisticated posture", "Elegant profile poise", "Sculptural silhouette", "Passionate yet professional expression".
2. **Inject Editorial Photography Parameters:** Always add professional camera, lighting, and environmental settings to ensure a high-end lookbook aesthetic:
   - Use lighting modifiers: `Chiaroscuro studio setting`, `soft dramatic shadows`, `warm golden hour light filtering through sheer curtains`, `cinematic rim lighting`.
   - Use camera/medium parameters: `Shot on 35mm film`, `Hasselblad/Phase One medium format photography`, `fine art composition`, `muted color palette`.
3. **Standard Commercial Safeguards:** Always append a robust negative prompt payload to steer the model toward clean, commercially viable, and high-quality outputs:
   - `"negative_prompt": "explicit nudity, pornography, vulgar, amateur, low quality, bad anatomy, distorted, generic layout"`

## Input Parameters
```json
{
  "type": "object",
  "properties": {
    "commercial_input": {
      "type": "string",
      "description": "The raw user or client product description (e.g., 'black lace lingerie model on a bed')"
    },
    "target_style": {
      "type": "string",
      "enum": ["minimalist-studio", "parisian-apartment", "fine-art-chiaroscuro"],
      "default": "minimalist-studio",
      "description": "The editorial background environment style."
    }
  },
  "required": ["commercial_input"]
}
```

## Output Format
Return a clean, production-ready JSON or text structure containing the optimized prompt payload.

### Example Execution
**User Input:** *"Red Valentine lingerie set in a bedroom"*
**Skill Output:**
```text
PROMPT: High-end fashion editorial lookbook photography of a premium crimson red silk and botanical lace couture garment set. An elegant model in a sophisticated, professional posture inside a dimly lit minimalist studio with warm golden hour light filtering through sheer curtains. Focus on the intricate textile textures and intimate fine art composition, shot on 35mm film, cinematic lighting.
NEGATIVE_PROMPT: explicit nudity, pornography, vulgar, amateur, low quality, bad anatomy, distorted, generic layout
```
