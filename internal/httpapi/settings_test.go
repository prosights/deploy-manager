package httpapi

import (
	"testing"

	"deploy-manager/internal/db"
)

func TestNormalizeInstanceSettingsTrimsAndDefaults(t *testing.T) {
	input, err := normalizeInstanceSettings(db.UpdateInstanceSettingsParams{
		Name:            " Deploy Manager ",
		ShortName:       " Deploy ",
		MetaDescription: " Internal control plane ",
		LogoUrl:         " /branding/logo.svg ",
		FaviconUrl:      "https://example.com/favicon.png",
	})
	if err != nil {
		t.Fatal(err)
	}

	if input.Name != "Deploy Manager" || input.ShortName != "Deploy" || input.MetaDescription != "Internal control plane" {
		t.Fatalf("unexpected normalized settings: %+v", input)
	}
	if input.PrimaryColor != "#0980fd" || input.DocsUrl != "#" {
		t.Fatalf("expected defaults, got %+v", input)
	}
}

func TestNormalizeInstanceSettingsRejectsInvalidColor(t *testing.T) {
	_, err := normalizeInstanceSettings(db.UpdateInstanceSettingsParams{
		Name:         "Deploy",
		ShortName:    "Deploy",
		PrimaryColor: "blue",
	})
	if err == nil {
		t.Fatal("expected invalid color to fail")
	}
}

func TestNormalizeInstanceSettingsRejectsControlCharactersInTextFields(t *testing.T) {
	_, err := normalizeInstanceSettings(db.UpdateInstanceSettingsParams{
		Name:            "Deploy",
		ShortName:       "Deploy",
		MetaDescription: "Internal\ncontrol plane",
		PrimaryColor:    "#0980fd",
	})
	if err == nil {
		t.Fatal("expected branding text with control characters to fail")
	}
}

func TestNormalizeInstanceSettingsRejectsUnsafeBrandURL(t *testing.T) {
	_, err := normalizeInstanceSettings(db.UpdateInstanceSettingsParams{
		Name:         "Deploy",
		ShortName:    "Deploy",
		PrimaryColor: "#0980fd",
		LogoUrl:      "javascript:alert(1)",
	})
	if err == nil {
		t.Fatal("expected unsafe logo URL to fail")
	}
}

func TestNormalizeInstanceSettingsRejectsProtocolRelativeBrandURL(t *testing.T) {
	_, err := normalizeInstanceSettings(db.UpdateInstanceSettingsParams{
		Name:         "Deploy",
		ShortName:    "Deploy",
		PrimaryColor: "#0980fd",
		LogoUrl:      "//example.com/logo.svg",
	})
	if err == nil {
		t.Fatal("expected protocol-relative logo URL to fail")
	}
}

func TestNormalizeInstanceSettingsRejectsControlCharactersInBrandURL(t *testing.T) {
	_, err := normalizeInstanceSettings(db.UpdateInstanceSettingsParams{
		Name:         "Deploy",
		ShortName:    "Deploy",
		PrimaryColor: "#0980fd",
		FaviconUrl:   "/branding/favicon\n.png",
	})
	if err == nil {
		t.Fatal("expected favicon URL with control characters to fail")
	}
}

func TestNormalizeInstanceSettingsRejectsUnsupportedBrandAssetURLs(t *testing.T) {
	tests := []db.UpdateInstanceSettingsParams{
		{
			Name:         "Deploy",
			ShortName:    "Deploy",
			PrimaryColor: "#0980fd",
			LogoUrl:      "/branding/logo.txt",
		},
		{
			Name:         "Deploy",
			ShortName:    "Deploy",
			PrimaryColor: "#0980fd",
			FaviconUrl:   "https://example.com/favicon.jpg",
		},
	}

	for _, test := range tests {
		_, err := normalizeInstanceSettings(test)
		if err == nil {
			t.Fatalf("expected unsupported asset URL to fail: %+v", test)
		}
	}
}

func TestNormalizeInstanceSettingsAllowsSupportedBrandAssetURLs(t *testing.T) {
	input, err := normalizeInstanceSettings(db.UpdateInstanceSettingsParams{
		Name:         "Deploy",
		ShortName:    "Deploy",
		PrimaryColor: "#0980fd",
		LogoUrl:      "/branding/logo.svg?v=1",
		FaviconUrl:   "https://example.com/favicon.ico?v=1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if input.LogoUrl != "/branding/logo.svg?v=1" || input.FaviconUrl != "https://example.com/favicon.ico?v=1" {
		t.Fatalf("expected supported asset URLs to be preserved, got %+v", input)
	}
}

func TestNormalizeInstanceSettingsAllowsUploadedBrandAssetDataURLs(t *testing.T) {
	input, err := normalizeInstanceSettings(db.UpdateInstanceSettingsParams{
		Name:         "Deploy",
		ShortName:    "Deploy",
		PrimaryColor: "#0980fd",
		LogoUrl:      "data:image/png;base64,aGVsbG8=",
		FaviconUrl:   "data:image/svg+xml;base64,PHN2Zy8+",
	})
	if err != nil {
		t.Fatal(err)
	}
	if input.LogoUrl == "" || input.FaviconUrl == "" {
		t.Fatalf("expected data URLs to be preserved, got %+v", input)
	}
}
