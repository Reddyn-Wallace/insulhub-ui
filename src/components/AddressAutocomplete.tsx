import { useState, useEffect, useRef } from "react";

interface AddressDetails {
    streetAddress: string;
    suburb: string;
    city: string;
    postCode: string;
}

interface AddressAutocompleteProps {
    value: string;
    onChange: (value: string) => void;
    onSelectAddress: (details: AddressDetails) => void;
    placeholder?: string;
    className?: string;
}

interface PhotonFeature {
    properties: {
        housenumber?: string;
        street?: string;
        name?: string;
        suburb?: string;
        district?: string;
        city?: string;
        county?: string;
        state?: string;
        postcode?: string;
        country?: string;
    };
}

export default function AddressAutocomplete({
    value,
    onChange,
    onSelectAddress,
    placeholder = "Search for an address...",
    className = "",
}: AddressAutocompleteProps) {
    const [query, setQuery] = useState(value || "");
    const [results, setResults] = useState<PhotonFeature[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    // Sync internal query with external value if it changes externally
    useEffect(() => {
        setQuery(value || "");
    }, [value]);

    // Click outside to close
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Debounced search
    useEffect(() => {
        if (!query || query.length < 3) {
            setResults([]);
            setIsOpen(false);
            return;
        }

        const timer = setTimeout(async () => {
            setLoading(true);
            try {
                // filter for New Zealand to improve accuracy, remove `&lat...&lon...` to make it general, but photon allows location bounds
                // For now, simple text search. We can append `&lat=-40.9006&lon=174.8860` for NZ bias or `&layer=house` for addresses
                // Using komoot photon open-source geocoder
                const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`);
                const data = await res.json();

                if (data && data.features) {
                    setResults(data.features);
                    setIsOpen(true);
                }
            } catch (err) {
                console.error("Failed to fetch address:", err);
            } finally {
                setLoading(false);
            }
        }, 500); // 500ms debounce

        return () => clearTimeout(timer);
    }, [query]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setQuery(val);
        onChange(val); // Bubble up exact typing
    };

    const handleSelect = (feature: PhotonFeature) => {
        const p = feature.properties;

        // Format the display string
        const parts = [];
        if (p.housenumber) parts.push(p.housenumber);
        if (p.street) parts.push(p.street);
        if (!p.street && p.name) parts.push(p.name);

        const streetAddress = parts.join(" ");

        // Attempt to extract fields
        const details: AddressDetails = {
            streetAddress: streetAddress,
            suburb: p.suburb || p.district || "",
            city: p.city || p.county || p.state || "",
            postCode: p.postcode || "",
        };

        setQuery(streetAddress || p.name || "");
        onChange(streetAddress || p.name || "");
        onSelectAddress(details);
        setIsOpen(false);
    };

    return (
        <div className="relative" ref={wrapperRef}>
            <input
                type="text"
                value={query}
                onChange={handleInputChange}
                onFocus={() => {
                    if (results.length > 0) setIsOpen(true);
                }}
                placeholder={placeholder}
                className={className}
            />

            {isOpen && results.length > 0 && (
                <ul className="absolute z-10 w-full bg-white border border-gray-200 shadow-lg rounded-lg mt-1 max-h-60 overflow-y-auto">
                    {results.map((r, i) => {
                        const p = r.properties;
                        const displayName = [
                            p.housenumber,
                            p.street || p.name,
                            p.suburb,
                            p.city,
                            p.postcode,
                        ]
                            .filter(Boolean)
                            .join(", ");

                        return (
                            <li
                                key={i}
                                onClick={() => handleSelect(r)}
                                className="px-4 py-2 hover:bg-orange-50 cursor-pointer text-sm text-gray-700 border-b last:border-0 border-gray-100"
                            >
                                {displayName}
                                {p.country && <span className="text-xs text-gray-400 block">{p.country}</span>}
                            </li>
                        );
                    })}
                </ul>
            )}
            {loading && (
                <div className="absolute right-3 top-2.5">
                    <svg className="animate-spin h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                </div>
            )}
        </div>
    );
}
