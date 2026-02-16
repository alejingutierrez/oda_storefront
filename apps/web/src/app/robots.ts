import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/catalogo", "/g/", "/novedades", "/estilo/", "/marca/"],
      disallow: ["/admin/", "/api/", "/auth/", "/sign-in", "/perfil"],
    },
    sitemap: [`${siteUrl}/sitemap.xml`],
    host: siteUrl,
  };
}

