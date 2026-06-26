package connectors

import "testing"

func TestNormalizeCredentialStatus(t *testing.T) {
	tests := map[string]struct {
		input string
		want  string
		ok    bool
	}{
		"blank defaults active": {
			input: " ",
			want:  "active",
			ok:    true,
		},
		"trims known status": {
			input: " rotating ",
			want:  "rotating",
			ok:    true,
		},
		"rejects unknown status": {
			input: "disabled",
			ok:    false,
		},
	}

	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			got, ok := NormalizeCredentialStatus(test.input)
			if ok != test.ok {
				t.Fatalf("expected ok=%v, got %v", test.ok, ok)
			}
			if got != test.want {
				t.Fatalf("expected %q, got %q", test.want, got)
			}
		})
	}
}
