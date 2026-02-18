from fastapi import FastAPI

from ncp.routers import agenda_routes, exhibitor_routes, keyword_routes, speaker_routes

app = FastAPI()

# Include the router from agenda_routes.py
# Routes will be at the root, e.g. /showAgenda
app.include_router(agenda_routes.router, tags=["Agendas"])
app.include_router(speaker_routes.router, tags=["Speakers"])
app.include_router(exhibitor_routes.router, tags=["Exhibitors"])
app.include_router(keyword_routes.router, tags=["Keywords"])  # Add this line

if __name__ == "__main__":
    # To run this server:
    # 1. Ensure fastapi and uvicorn are installed:
    #    pip install fastapi uvicorn[standard]
    #    (or ensure they are in your requirements.txt and install).
    # 2. Run with uvicorn from your project root:
    #    uvicorn apps.ncp.ncp:app --reload --port 8000
    #    (assuming this file is in apps/ncp/ and your project root is in PYTHONPATH)
    #
    # Or, for simpler direct execution of this file:
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
