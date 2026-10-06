/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// --- 1. Data Layer ---
export const products = [
    {
        id: 1,
        name: "SonicBlast Go",
        image: "img/speaker-3.png",
        specs: {
            "Power": {
                battery: "12 hours Runtime",
                power: "20W Audio Power",
                charging: "USB-C Fast Charge"
            },
            "Durability": {
                waterproof: "IPX7 Waterproof Rating",
                shockproof: "Drop resistant up to 1.5m"
            },
            "Portability": {
                weight: "500g Weight",
                dimensions: "15x8x8 cm"
            }
        },
        reviews: [
            "Great for the pool, very waterproof. I take it everywhere.",
            "Battery lasts all day on a single charge, amazing.",
            "A bit heavy for its size, but sounds good.",
            "USB-C charging is super fast, love it.",
            "20W is surprisingly loud, perfect for parties.",
            "Dropped it on the concrete twice, not a scratch."
        ]
    },
    {
        id: 2,
        name: "AuraWave Pro",
        image: "img/speaker-1.png",
        specs: {
            "Power": {
                battery: "24 hours Runtime",
                power: "40W Audio Power",
                charging: "Wireless Qi Supported"
            },
            "Durability": {
                waterproof: "IP67 Dust & Waterproof",
                shockproof: "Rugged design"
            },
            "Portability": {
                weight: "800g Weight",
                dimensions: "20x10x10 cm"
            }
        },
        reviews: [
            "Incredible battery life, I rarely charge it.",
            "Dustproof and waterproof, perfect for camping.",
            "Heavy, but the sound fills the room.",
            "Wireless charging is so convenient on my desk.",
            "40W power really fills the room with deep bass.",
            "Dropped it on rocks while hiking, still works perfectly."
        ]
    },
    {
        id: 3,
        name: "LiteBeat Mini",
        image: "img/speaker-2.png",
        specs: {
            "Power": {
                battery: "6 hours Runtime",
                power: "5W Audio Power",
                charging: "Micro USB"
            },
            "Durability": {
                waterproof: "IPX5 Splash resistant",
                shockproof: "Not rated"
            },
            "Portability": {
                weight: "200g Weight",
                dimensions: "10x5x5 cm"
            }
        },
        reviews: [
            "Super light, fits in my pocket easily.",
            "Water resistance is just okay for light rain. Don't drop it in the pool.",
            "Not very powerful, but good for quiet listening.",
            "Micro USB is a bit dated, I wish it was USB-C.",
            "6 hours is enough for a small outing, but not all day.",
            "I'm afraid to drop it since it has no shock rating."
        ]
    }
];
