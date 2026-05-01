# Smart Map AI Navigation

## Overview
Smart Map AI Navigation is an advanced, interactive mapping and routing application that integrates artificial intelligence for traffic analysis, route optimization, and location-based assistance. It features a realistic 3D map environment, multi-modal vehicle routing, and conversational AI analysis.

## Features
- **3D Map Visualization**: Experience realistic terrain, 3D buildings, and custom map themes (Dark, Blueprint, Minimal, Realistic) powered by MapLibre GL.
- **Multi-Modal Routing**: Search and navigate directions using various transportation modes (driving, motorcycle, cycling, walking, train, ship, plane).
- **Simulated Traffic Overlay**: View visualized traffic conditions (closed, heavy, moderate, low) with realistic speed impact estimations.
- **AI Route Analysis**: Obtain intelligent insights and travel tips through the integrated Groq AI model (Llama 3).
- **Interactive Chat Assistant**: Ask localized questions about your destination, route conditions, or general travel advice.
- **Elevation and Depth Tracking**: Monitor real-time terrain elevation and depth as you explore the map.

## Technology Stack
- **Frontend**: React 18, Vite, Tailwind CSS
- **Map Engine**: MapLibre GL JS, React Map GL
- **Routing API**: OSRM (Open Source Routing Machine)
- **Geocoding API**: Nominatim (OpenStreetMap)
- **Backend / AI Integration**: Node.js, Express.js, TypeScript, Groq SDK

## Prerequisites
- Node.js (v18 or higher)
- npm or yarn

## Local Development Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd <repository-directory>
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment Variables**
   Create a `.env` file in the root directory and add your Groq API key:
   ```env
   GROQ_API_KEY="your_groq_api_key_here"
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```
   The application will be available at `http://localhost:3000`.

## Production Build

To build the project for production:

```bash
npm run build
```
This command compiles both the React frontend and the Express backend.

To start the production server:
```bash
npm start
```

## Deployment to Netlify

By default, Netlify is optimized for static site hosting. Because this application requires a backend server (`server.ts`) to securely access the Groq API and serve the `/api/chat` route, deploying it as a basic static site on Netlify will cause the AI features to fail. 

To deploy to Netlify, follow **Option 1**, or consider alternative hosting in **Option 2**.

### Option 1: Client-Side AI (Netlify Static Hosting)
If you wish to deploy exclusively to Netlify without setting up Netlify Functions, you can adjust the app to call Groq directly from the frontend.
**Warning**: This approach will expose your Groq API key in the browser.

1. Move the Groq API call logic from `server.ts` into your React component.
2. Initialize Groq with browser access allowed: `new Groq({ apiKey: import.meta.env.VITE_GROQ_API_KEY, dangerouslyAllowBrowser: true })`.
3. Rename the environment variable to `VITE_GROQ_API_KEY` in Netlify settings.
4. Add a `netlify.toml` file to root directory to handle client-side routing:
   ```toml
   [build]
     command = "npm run build"
     publish = "dist"

   [[redirects]]
     from = "/*"
     to = "/index.html"
     status = 200
   ```

### Option 2: Render or Railway (Recommended for Full-Stack)
Since the application already includes a complete Express.js server, the easiest way to deploy without modifying the codebase is to use a container/server host:
1. Push your code to GitHub.
2. Sign up for **Render**, **Railway**, or **Heroku**.
3. Create a new Web Service and link your GitHub repository.
4. Set the Build Command to `npm install && npm run build`.
5. Set the Start Command to `npm start`.
6. Add `GROQ_API_KEY` to the Environment Variables in the service settings.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
# zeroroute
